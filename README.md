ng-youtube-upload
======================

This is an angular model that will let you log into youtube and then upload a video to your channel from your website. Uses bootstrap, with its own CSS.

An Angular wrapper on the [YouTube v3 API](https://developers.google.com/youtube/v3/docs/)

## Usage

 - Include the `app/ng-youtube-upload.js` and `app/upload_video.html` files in your project.

 - Include ng-youtube-upload as a dependency for your Angular app:

        var myApp = angular.module('MyApp', ['youtube-video']);

 - Then simply use the directive in a template. "clientid" is your App's YouTube Client API which you can find [here](https://developers.google.com/youtube/registering_an_application):

        <div youtube-video-upload clientid="YOUR CLIENT ID" data-video-title="{{name}}" data-video-desc="{{desc}}"></div>