/*
 Copyright 2015 Google Inc. All Rights Reserved.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

var DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v2/files/';


/**
 * Helper for implementing retries with backoff. Initial retry
 * delay is 1 second, increasing by 2x (+jitter) for subsequent retries
 *
 * @constructor
 */
var RetryHandler = function() {
    this.interval = 1000; // Start at one second
    this.maxInterval = 60 * 1000; // Don't wait longer than a minute
};

/**
 * Invoke the function after waiting
 *
 * @param {function} fn Function to invoke
 */
RetryHandler.prototype.retry = function(fn) {
    setTimeout(fn, this.interval);
    this.interval = this.nextInterval_();
};

/**
 * Reset the counter (e.g. after successful request.)
 */
RetryHandler.prototype.reset = function() {
    this.interval = 1000;
};

/**
 * Calculate the next wait time.
 * @return {number} Next wait interval, in milliseconds
 *
 * @private
 */
RetryHandler.prototype.nextInterval_ = function() {
    var interval = this.interval * 2 + this.getRandomInt_(0, 1000);
    return Math.min(interval, this.maxInterval);
};

/**
 * Get a random int in the range of min to max. Used to add jitter to wait times.
 *
 * @param {number} min Lower bounds
 * @param {number} max Upper bounds
 * @private
 */
RetryHandler.prototype.getRandomInt_ = function(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
};


/**
 * Helper class for resumable uploads using XHR/CORS. Can upload any Blob-like item, whether
 * files or in-memory constructs.
 *
 * @example
 * var content = new Blob(["Hello world"], {"type": "text/plain"});
 * var uploader = new MediaUploader({
 *   file: content,
 *   token: accessToken,
 *   onComplete: function(data) { ... }
 *   onError: function(data) { ... }
 * });
 * uploader.upload();
 *
 * @constructor
 * @param {object} options Hash of options
 * @param {string} options.token Access token
 * @param {blob} options.file Blob-like item to upload
 * @param {string} [options.fileId] ID of file if replacing
 * @param {object} [options.params] Additional query parameters
 * @param {string} [options.contentType] Content-type, if overriding the type of the blob.
 * @param {object} [options.metadata] File metadata
 * @param {function} [options.onComplete] Callback for when upload is complete
 * @param {function} [options.onProgress] Callback for status for the in-progress upload
 * @param {function} [options.onError] Callback if upload fails
 */
var MediaUploader = function(options) {
    var noop = function() {};
    this.file = options.file;
    this.contentType = options.contentType || this.file.type || 'application/octet-stream';
    this.metadata = options.metadata || {
        'title': this.file.name,
        'mimeType': this.contentType
    };
    this.token = options.token;
    this.onComplete = options.onComplete || noop;
    this.onProgress = options.onProgress || noop;
    this.onError = options.onError || noop;
    this.offset = options.offset || 0;
    this.chunkSize = options.chunkSize || 0;
    this.retryHandler = new RetryHandler();

    this.url = options.url;
    if (!this.url) {
        var params = options.params || {};
        params.uploadType = 'resumable';
        this.url = this.buildUrl_(options.fileId, params, options.baseUrl);
    }
    this.httpMethod = options.fileId ? 'PUT' : 'POST';
};

/**
 * Initiate the upload.
 */
MediaUploader.prototype.upload = function() {
    var self = this;
    var xhr = new XMLHttpRequest();

    xhr.open(this.httpMethod, this.url, true);
    xhr.setRequestHeader('Authorization', 'Bearer ' + this.token);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('X-Upload-Content-Length', this.file.size);
    xhr.setRequestHeader('X-Upload-Content-Type', this.contentType);

    xhr.onload = function(e) {
        if (e.target.status < 400) {
            var location = e.target.getResponseHeader('Location');
            this.url = location;
            this.sendFile_();
        } else {
            this.onUploadError_(e);
        }
    }.bind(this);
    xhr.onerror = this.onUploadError_.bind(this);
    xhr.send(JSON.stringify(this.metadata));
};

/**
 * Send the actual file content.
 *
 * @private
 */
MediaUploader.prototype.sendFile_ = function() {
    var content = this.file;
    var end = this.file.size;

    if (this.offset || this.chunkSize) {
        // Only bother to slice the file if we're either resuming or uploading in chunks
        if (this.chunkSize) {
            end = Math.min(this.offset + this.chunkSize, this.file.size);
        }
        content = content.slice(this.offset, end);
    }

    var xhr = new XMLHttpRequest();
    xhr.open('PUT', this.url, true);
    xhr.setRequestHeader('Content-Type', this.contentType);
    xhr.setRequestHeader('Content-Range', 'bytes ' + this.offset + '-' + (end - 1) + '/' + this.file.size);
    xhr.setRequestHeader('X-Upload-Content-Type', this.file.type);
    if (xhr.upload) {
        xhr.upload.addEventListener('progress', this.onProgress);
    }
    xhr.onload = this.onContentUploadSuccess_.bind(this);
    xhr.onerror = this.onContentUploadError_.bind(this);
    xhr.send(content);
};

/**
 * Query for the state of the file for resumption.
 *
 * @private
 */
MediaUploader.prototype.resume_ = function() {
    var xhr = new XMLHttpRequest();
    xhr.open('PUT', this.url, true);
    xhr.setRequestHeader('Content-Range', 'bytes */' + this.file.size);
    xhr.setRequestHeader('X-Upload-Content-Type', this.file.type);
    if (xhr.upload) {
        xhr.upload.addEventListener('progress', this.onProgress);
    }
    xhr.onload = this.onContentUploadSuccess_.bind(this);
    xhr.onerror = this.onContentUploadError_.bind(this);
    xhr.send();
};

/**
 * Extract the last saved range if available in the request.
 *
 * @param {XMLHttpRequest} xhr Request object
 */
MediaUploader.prototype.extractRange_ = function(xhr) {
    var range = xhr.getResponseHeader('Range');
    if (range) {
        this.offset = parseInt(range.match(/\d+/g).pop(), 10) + 1;
    }
};

/**
 * Handle successful responses for uploads. Depending on the context,
 * may continue with uploading the next chunk of the file or, if complete,
 * invokes the caller's callback.
 *
 * @private
 * @param {object} e XHR event
 */
MediaUploader.prototype.onContentUploadSuccess_ = function(e) {
    if (e.target.status == 200 || e.target.status == 201) {
        this.onComplete(e.target.response);
    } else if (e.target.status == 308) {
        this.extractRange_(e.target);
        this.retryHandler.reset();
        this.sendFile_();
    }
};

/**
 * Handles errors for uploads. Either retries or aborts depending
 * on the error.
 *
 * @private
 * @param {object} e XHR event
 */
MediaUploader.prototype.onContentUploadError_ = function(e) {
    if (e.target.status && e.target.status < 500) {
        this.onError(e.target.response);
    } else {
        this.retryHandler.retry(this.resume_.bind(this));
    }
};

/**
 * Handles errors for the initial request.
 *
 * @private
 * @param {object} e XHR event
 */
MediaUploader.prototype.onUploadError_ = function(e) {
    this.onError(e.target.response); // TODO - Retries for initial upload
};

/**
 * Construct a query string from a hash/object
 *
 * @private
 * @param {object} [params] Key/value pairs for query string
 * @return {string} query string
 */
MediaUploader.prototype.buildQuery_ = function(params) {
    params = params || {};
    return Object.keys(params).map(function(key) {
        return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    }).join('&');
};

/**
 * Build the drive upload URL
 *
 * @private
 * @param {string} [id] File ID if replacing
 * @param {object} [params] Query parameters
 * @return {string} URL
 */
MediaUploader.prototype.buildUrl_ = function(id, params, baseUrl) {
    var url = baseUrl || DRIVE_UPLOAD_URL;
    if (id) {
        url += id;
    }
    var query = this.buildQuery_(params);
    if (query) {
        url += '?' + query;
    }
    return url;
};

/**~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Youtube Upload Directive -
 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~*/
angular.module('ng-youtube-upload', [
    'ngAnimate',
    'ngFileUpload',
    'mgcrea.ngStrap'
])
    .run(['$window', '$rootScope', function ($window, $rootScope) {

        if (!angular.element('link#youtubeVideoCSS').length) {
            angular.element('head').append('<style id="youtubeVideoCSS">#channel-image{width:2em;height:2em;vertical-align:middle}#channel-name{margin-left:.2em;margin-right:.2em}#disclaimer{font-size:.75em;color:#aeaeae;max-width:350px}body{font-family:"Open Sans",sans-serif;font-size:1.5em}.post-sign-in{display:none}.during-upload{display:none}.post-upload{display:none}label{display:block}progress{font-size:.75em;width:15em;margin-bottom:1em;padding:.5em;font-family:"Open Sans",sans-serif}textarea{height:7em}.btn-file{position:relative;overflow:hidden}.btn-file input[type=file]{position:absolute;top:0;right:0;min-width:100%;min-height:100%;font-size:100px;text-align:right;filter:alpha(opacity=0);opacity:0;outline:none;background:#fff;cursor:inherit;display:block}</style>');
        }

        $window.signinCallback = function (authResult) {
            if (authResult && authResult.access_token) {
                $rootScope.$broadcast('event:google-plus-signin-success', authResult);
            } else {
                $rootScope.$broadcast('event:google-plus-signin-failure', authResult);
            }
        };

    }])
    .directive('youtubeUploader', ['$window', '$alert', function ($window, $alert) {
        'use strict';

        return {
            restrict: 'AE',
            templateUrl: "/templates/ng-youtube-upload.html",
            scope: {
                videoTitle: "@",
                videoDesc: "@"
            },
            link: function ($scope, $element, $attrs) {

                var STATUS_POLLING_INTERVAL_MILLIS = 10 * 1000; // One minute.
                var ending = /\.apps\.googleusercontent\.com$/;

                $attrs.clientid += (ending.test($attrs.clientid) ? '' : '.apps.googleusercontent.com');

                $attrs.$set('data-clientid', $attrs.clientid);
                $attrs.$set('theme', $attrs.theme);

                var status = {
                    init: 10,
                    uploading: 20,
                    processing: 30,
                    final: 40,
                    error: 50
                };

                var setStatus = function (newStatus, params) {
                    $scope.status = newStatus;
                    switch ($scope.status) {
                        case status.init:
                            break;
                        case status.uploading:
                            $scope.$emit('event:youtube-video-uploading');
                            $('#uploadButton').attr('disabled', true);
                            break;
                        case status.processing:
                            $scope.$emit('event:youtube-video-uploaded', params[0]);
                            break;
                        case status.final:
                            $scope.$emit('event:youtube-video-processed', params[0]);
                            $('#uploadButton').attr('disabled', false);
                            break;
                        case status.error:
                            $scope.$emit('event:youtube-video-failed', params[0]);
                            $('#uploadButton').attr('disabled', false);
                            break;
                    }
                };

                setStatus(status.init);

                // Some default values, based on prior versions of this directive
                var defaults = {
                    callback: 'signinCallback',
                    cookiepolicy: 'single_host_origin',
                    requestvisibleactions: 'http://schemas.google.com/AddActivity',
                    scope: 'https://www.googleapis.com/auth/plus.login https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube',
                    height: 'standard',
                    width: 'wide',
                    state: '',
                    showprivacy: false,
                    videoTitle: "Upload a Video",
                    clientid: "YOUR CLIENT ID HERE"
                };

                defaults.clientid = $attrs.clientid;
                defaults.theme = $attrs.theme;

                // Overwrite default values if explicitly set
                angular.forEach(Object.getOwnPropertyNames(defaults), function (propName) {
                    if ($attrs.hasOwnProperty(propName)) {
                        defaults[propName] = $attrs[propName];
                    }
                });

                $scope.displayUploader = false;
                $scope.videoFile = null;
                $scope.videoName = "";

                $scope.$watch('videoFiles', function () {
                    if (($scope.videoFiles) && ($scope.videoFiles.length > 0)) {
                        $scope.videoFile = $scope.videoFiles[0];
                        $scope.videoName = $scope.videoFiles[0].name;
                    }
                });

                $scope.fileNameChanged = function (elem) {
                    $scope.videoFile = elem.files[0];
                    $scope.videoName = elem.files[0].name;
                    $scope.$apply();
                };


                // Default language
                // Supported languages: https://developers.google.com/+/web/api/supported-languages
                $attrs.$observe('language', function (value) {
                    $window.___gcfg = {
                        lang: value ? value : 'en'
                    };
                });

                // Asynchronously load the G+ SDK.
                var po = document.createElement('script');
                po.type = 'text/javascript';
                po.async = true;
                po.src = 'https://apis.google.com/js/client:plusone.js';
                var s = document.getElementsByTagName('script')[0];
                s.parentNode.insertBefore(po, s);

                po.onload = function () {
                    var anchor = document.createElement('span');
                    anchor.id = "signInButton";
                    $element.prepend(anchor);

                    gapi.signin.render(anchor, defaults);
                };

                $scope.$on('event:google-plus-signin-success', function (event, authResult) {
                    $('#signInButton').hide();
                    $scope.displayUploader = true;
                    $scope.$apply();
                    if (authResult.access_token) {
                        var uploadVideo = new UploadVideo();
                        uploadVideo.ready(authResult.access_token);
                    }
                });

                /**
                 * YouTube video uploader class
                 *
                 * @constructor
                 */
                var UploadVideo = function () {
                    /**
                     * The array of tags for the new YouTube video.
                     *
                     * @attribute tags
                     * @type Array.<string>
                     * @default ['google-cors-upload']
                     */
                    this.tags = ['youtube-cors-upload'];

                    /**
                     * The numeric YouTube
                     * [category id](https://developers.google.com/apis-explorer/#p/youtube/v3/youtube.videoCategories.list?part=snippet&regionCode=us).
                     *
                     * @attribute categoryId
                     * @type number
                     * @default 22
                     */
                    this.categoryId = 22;

                    /**
                     * The id of the new video.
                     *
                     * @attribute videoId
                     * @type string
                     * @default ''
                     */
                    this.videoId = '';

                    this.uploadStartTime = 0;
                };


                UploadVideo.prototype.ready = function (accessToken) {
                    this.accessToken = accessToken;
                    this.gapi = $window.gapi;
                    this.authenticated = true;
                    this.gapi.client.request({
                        path: '/youtube/v3/channels',
                        params: {
                            part: 'snippet',
                            mine: true
                        },
                        callback: function (response) {
                            if (response.error) {
                                console.log(response.error.message);
                            }
                        }.bind(this)
                    });
                    $('#uploadButton').on("click", this.handleUploadClicked.bind(this));
                };

                /**
                 * Uploads a video file to YouTube.
                 *
                 * @method uploadFile
                 * @param {object} file File object corresponding to the video to upload.
                 */
                UploadVideo.prototype.uploadFile = function (file) {
                    var metadata = {
                        snippet: {
                            title: $scope.videoTitle,
                            description: $scope.videoDesc,
                            tags: this.tags,
                            categoryId: this.categoryId
                        },
                        status: {
                            privacyStatus: "public",
                            embeddable: true
                        }
                    };
                    var uploader = new MediaUploader({
                        baseUrl: 'https://www.googleapis.com/upload/youtube/v3/videos',
                        file: file,
                        token: this.accessToken,
                        metadata: metadata,
                        params: {
                            part: Object.keys(metadata).join(',')
                        },
                        //access_type: 'offline',
                        onError: function (data) {
                            var message = data;
                            // Assuming the error is raised by the YouTube API, data will be
                            // a JSON string with error.message set. That may not be the
                            // only time onError will be raised, though.
                            try {
                                var errorResponse = JSON.parse(data);
                                message = errorResponse.error.message;
                            } finally {
                                alert(message);
                            }
                        }.bind(this),
                        onProgress: function (data) {
                            var currentTime = Date.now();
                            var bytesUploaded = data.loaded;
                            var totalBytes = data.total;
                            // The times are in millis, so we need to divide by 1000 to get seconds.
                            var bytesPerSecond = bytesUploaded / ((currentTime - this.uploadStartTime) / 1000);
                            var estimatedSecondsRemaining = (totalBytes - bytesUploaded) / bytesPerSecond;
                            var percentageComplete = (bytesUploaded * 100) / totalBytes;

                            $('#upload-progress').attr({
                                value: bytesUploaded,
                                max: totalBytes
                            });

                            $('#transferred').css('width', percentageComplete.toFixed(2) + '%').attr('aria-valuenow', percentageComplete.toFixed(2)).text(bytesUploaded + " / " + totalBytes + "  (" + percentageComplete.toFixed(2) + "%)");
                            /*
                             $('#percent-transferred').text(percentageComplete.toFixed(2));
                             $('#bytes-transferred').text(bytesUploaded);
                             $('#total-bytes').text(totalBytes);*/

                            $('.during-upload').show();
                        }.bind(this),
                        onComplete: function (data) {
                            var uploadResponse = JSON.parse(data);
                            this.videoId = uploadResponse.id;
                            $('#video-id').text(this.videoId);
                            $('.post-upload').show();
                            this.pollForVideoStatus();
                        }.bind(this)
                    });
                    // This won't correspond to the *exact* start of the upload, but it should be close enough.
                    this.uploadStartTime = Date.now();
                    uploader.upload();
                };

                UploadVideo.prototype.handleUploadClicked = function () {

                    if ($scope.videoTitle == "") {
                        $alert({
                            content: "Please enter a title for your video.",
                            placement: 'top-right',
                            type: 'warning',
                            duration: 3
                        });
                    } else if ($scope.videoDesc == "") {
                        $alert({
                            content: "Please enter a description for your video.",
                            placement: 'top-right',
                            type: 'warning',
                            duration: 3
                        });
                    } else if ($scope.status == status.uploading) {
                        $alert({
                            content: "Please wait until your video has finished uploading before uploading another one.",
                            placement: 'top-right',
                            type: 'warning',
                            duration: 3
                        });
                    } else if ($scope.status == status.processing) {
                        $alert({
                            content: "Please wait until your video has finished processing before uploading another one.",
                            placement: 'top-right',
                            type: 'warning',
                            duration: 3
                        });
                    } else {
                        setStatus(status.uploading);
                        this.uploadFile($scope.videoFile);
                    }
                };

                UploadVideo.prototype.pollForVideoStatus = function () {
                    this.gapi.client.request({
                        path: '/youtube/v3/videos',
                        params: {
                            part: 'status,player',
                            id: this.videoId
                        },
                        callback: function (response) {
                            if (response.error) {
                                // The status polling failed.
                                console.log(response.error.message);
                                setTimeout(this.pollForVideoStatus.bind(this), STATUS_POLLING_INTERVAL_MILLIS);
                            } else {
                                var uploadStatus = response.items[0].status.uploadStatus;
                                switch (uploadStatus) {
                                    // This is a non-final status, so we need to poll again.
                                    case 'uploaded':
                                        setStatus(status.processing, [{
                                            id: response.items[0].id,
                                            type: response.items[0].kind
                                        }]);
                                        setTimeout(this.pollForVideoStatus.bind(this), STATUS_POLLING_INTERVAL_MILLIS);
                                        break;
                                    // The video was successfully transcoded and is available.
                                    case 'processed':
                                        setStatus(status.final, [{
                                            id: response.items[0].id,
                                            type: response.items[0].kind
                                        }]);
                                        break;
                                    // All other statuses indicate a permanent transcoding failure.
                                    default:
                                        setStatus(status.error, [{message: response.items[0].status.uploadStatus + ": " + response.items[0].status.rejectionReason}]);
                                        break;
                                }
                            }
                        }.bind(this)
                    });
                };
            }
        };
    }]);

angular.module("ng-youtube-upload").run(["$templateCache", function($templateCache) {$templateCache.put("/templates/ng-youtube-upload.html","<div data-ng-show=\"displayUploader\">\r\n    <div>\r\n        <div class=\'row\' style=\"padding-top: 15px;\">\r\n            <div class =\'col-md-12\'>\r\n                <div class=\"form-group drop-box\" style=\"padding-top: 10px;height:100px;\"\r\n                     ngf-drop\r\n                     data-ng-model=\"videoFiles\"\r\n                     ngf-accept=\"\'video/*\'\"\r\n                     ngf-drag-over-class=\"dragover\"\r\n                     ngf-multiple=\"false\"\r\n                        >\r\n                    <p>Choose a video from your computer: .MOV, .MPEG4, MP4, .AVI, .WMV, .MPEGPS, .FLV, 3GPP, WebM</p>\r\n                </div>\r\n                <div ngf-no-file-drop>File Drag/drop is not supported</div>\r\n            </div>\r\n        </div>\r\n\r\n        <div class=\"btn-group-vertical\">\r\n            <div class=\"input-group\">\r\n                <span class=\"input-group-btn\">\r\n                    <span class=\"btn btn-primary btn-file\" >\r\n                       <span class=\"glyphicon glyphicon-folder-open\"></span> Browse <input type=\"file\" id=\"file\" class=\"file\" accept=\"video/*\" onchange=\"angular.element(this).scope().fileNameChanged(this)\">\r\n                    </span>\r\n                </span>\r\n                <input type=\"text\" name=\"videoName\" class=\"form-control\" readonly value=\"{{videoName}}\">\r\n            </div>\r\n            <button type=\"button\" id=\"uploadButton\" class=\"btn btn-success\" data-ng-disabled=\"videoName == \'\'\"><span class=\"glyphicon glyphicon-upload\"></span> Upload Video</button>\r\n        </div>\r\n\r\n        <div class=\"during-upload\">\r\n            <div class=\"progress\">\r\n                <div id=\"transferred\" class=\"progress-bar progress-bar-success\" role=\"progressbar\" aria-valuenow=\"{{progress.percentTransferred}}\"\r\n                     aria-valuemin=\"0\" aria-valuemax=\"100\" style=\"width:100%\">\r\n                    {{progress.percentTransferred}}% Complete (success)\r\n                </div>\r\n            </div>\r\n\r\n            <div align=\"center\" class=\"embed-responsive embed-responsive-16by9\">\r\n                <video controls ngf-src=\"videoFile\" ngf-accept=\"\'video/*\'\"></video>\r\n            </div>\r\n        </div>\r\n        <p><small id=\"disclaimer\">* By uploading a video, you certify that you own all rights to the content or that you are\r\n            authorized by the owner to make the content publicly available on YouTube, and that it otherwise complies\r\n            with the YouTube Terms of Service located at <a href=\"http://www.youtube.com/t/terms\" target=\"_blank\">http://www.youtube.com/t/terms</a>\r\n        </small></p>\r\n    </div>\r\n\r\n    <script src=\"//ajax.googleapis.com/ajax/libs/jquery/1.10.2/jquery.min.js\"></script>\r\n    <script src=\"//apis.google.com/js/client:plusone.js\"></script>\r\n</div>");}]);