
var bases = {
    app: 'app/',
    dist: 'dist/'
};

var paths = {
    scripts: [bases.app + 'ng_youtube_upload.js', bases.app + 'cors_upload.js', 'bower_components/ng-file-upload/ng-file-upload-all.min.js'],
    html: bases.app + 'ng_youtube_upload.html'
};

var gulp = require('gulp');
var concat = require('gulp-concat');
var compress = require('compression');
var templates = require('gulp-angular-templatecache');
var del = require('del');
var pkg = require('./package.json');
var jsValidate = require('gulp-jsvalidate');

gulp.task('validate', function () {
    return gulp.src(paths.scripts)
        .pipe(jsValidate());
});


gulp.task('templates', function () {
    return gulp.src(paths.html)
        .pipe(templates('templates.tmp', {
            root: '/templates/',
            module: pkg.name
        }))
        .pipe(gulp.dest('.'));
});

gulp.task('concat', ['templates'], function () {
    return gulp.src([pkg.main, 'templates.tmp'])
        .pipe(concat(pkg.name + '.js'))
        .pipe(gulp.dest('./dist/'));
});

gulp.task('clean', function (cb) {
    del(['./*.tmp'], cb);
});

gulp.task('compress', function() {
    gulp.src(
        paths.scripts
    )
        .pipe(concat('ng-youtube-upload.min.js'))
        .pipe(gulp.dest('dist'));
});

gulp.task('default', ['templates', 'concat', 'clean', 'validate', 'compress',]);

