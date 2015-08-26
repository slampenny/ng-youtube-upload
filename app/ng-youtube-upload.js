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
