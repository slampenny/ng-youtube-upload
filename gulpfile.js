
var bases = {
    app: 'app/',
    dist: 'dist/'
};

var paths = {
    scripts: bases.app + 'upload_video.js',
    html: bases.app + 'upload_video.html',
    css: bases.app + 'upload_video.css'
};

var gulp = require('gulp');
var uglify = require('gulp-uglify');
var concat = require('gulp-concat');
var compress = require('compression');
var jsValidate = require('gulp-jsvalidate');

gulp.task('validate', function () {
    return gulp.src(paths.scripts)
        .pipe(jsValidate());
});

gulp.task('compress', function() {
    gulp.src([
        paths.scripts,
        paths.html,
        paths.css
    ])
        .pipe(concat('upload_video.min.js'))
        .pipe(uglify())
        .pipe(gulp.dest('dist'));
});

gulp.task('default', ['validate', 'compress']);

