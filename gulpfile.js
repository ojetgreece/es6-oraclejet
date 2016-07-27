// Node modules
var fs = require('fs'),
    vm = require('vm'),
    merge = require('deeply'),
    chalk = require('chalk'),
    es = require('event-stream'),
    path = require('path'),
    url = require('url');

// Gulp and plugins
var gulp = require('gulp'),
    rjs = require('gulp-requirejs-bundler'),
    concat = require('gulp-concat'),
    clean = require('gulp-clean'),
    filter = require('gulp-filter'),
    replace = require('gulp-replace'),
    uglify = require('gulp-uglify'),
    htmlreplace = require('gulp-html-replace'),
    connect = require('gulp-connect'),
    babelCore = require('babel-core'),
    babel = require('gulp-babel'),
    objectAssign = require('object-assign');

// Config
var requireJsRuntimeConfig = vm.runInNewContext(fs.readFileSync('src/app/require.config.js') + '; require;'),
    requireJsOptimizerConfig = merge(requireJsRuntimeConfig, {
        out: 'scripts.js',
        baseUrl: './src',
        name: 'app/startup',
        paths: {
            requireLib: 'bower_modules/requirejs/require'
        },
        include: [
            'requireLib',
            'containers/home/home',
            'containers/product/product',
            'components/nav-bar/nav-bar',
            'text!components/bss-footer/footer.html'
        ],
        insertRequire: ['app/startup'],
        bundles: {
            // If you want parts of the site to load on demand, remove them from the 'include' list
            // above, and group them into bundles here.
            // 'bundle-name': [ 'some/module', 'another/module' ],
            // 'another-bundle-name': [ 'yet-another-module' ]
        }
    }),
    transpilationConfig = {
        root: 'src',
        skip: ['bower_modules/**', 'app/require.config.js'],
        babelConfig: {
            modules: 'amd',
            sourceMaps: 'inline',
            stage: 0
        }
    },
    babelIgnoreRegexes = transpilationConfig.skip.map(function(item) {
        return babelCore.util.regexify(item);
    });

// Pushes all the source files through Babel for transpilation
gulp.task('js:babel', function() {
    return gulp.src(requireJsOptimizerConfig.baseUrl + '/**')
        .pipe(es.map(function(data, cb) {
            if (!data.isNull()) {
                babelTranspile(data.relative, function(err, res) {
                    if (res) {
                        data.contents = new Buffer(res.code);
                    }
                    cb(err, data);
                });
            } else {
                cb(null, data);
            }
        }))
        .pipe(gulp.dest('./temp'));
});

// Discovers all AMD dependencies, concatenates together all required .js files, minifies them
gulp.task('js:optimize', ['js:babel'], function() {
    var config = objectAssign({}, requireJsOptimizerConfig, { baseUrl: 'temp' });
    return rjs(config)
        .pipe(uglify({ preserveComments: 'some' }))
        .pipe(gulp.dest('./dist/'));
})

// Builds the distributable .js files by calling Babel then the r.js optimizer
gulp.task('js', ['js:optimize'], function () {
    // Now clean up
    return gulp.src('./temp', { read: false }).pipe(clean());
});

// Concatenates CSS files, rewrites relative paths to Bootstrap fonts, copies Bootstrap fonts
gulp.task('css', function () {
    //JET css
    var bowerCss = gulp.src('src/bower_modules/oraclejet/dist/css/alta/oj-alta-min.css')
            .pipe(replace(/url\((')?\.\.\/fonts\//g, 'url($1fonts/')),
        appCss = gulp.src('src/css/*.css'),
        ojFonts = gulp.src('./src/bower_modules/oraclejet/dist/css/alta/fonts/**/*', {
            base: './src/bower_modules/oraclejet/dist/css/alta/'
        }),
        ojImgFiles = gulp.src('./src/bower_modules/oraclejet/dist/css/alta/images/**/*', {
            base: './src/bower_modules/oraclejet/dist/css/alta/'
        }),
        ojImgFilesCommon = gulp.src('./src/bower_modules/oraclejet/dist/css/common/**/*', {
            base: './src/bower_modules/oraclejet/dist/css/'
        }),
        ojImgFilesSpecific = gulp.src('./src/bower_modules/oraclejet/dist/js/libs/oj/resources/**/*', {
            base: './src/bower_modules/oraclejet/dist/js/libs/oj'
        });


    //Copy OJ NLS
    gulp.src('./src/bower_modules/oraclejet/dist/js/libs/oj/resources/nls/**/*', {
        base: './src/bower_modules/oraclejet/dist/js/libs/oj/resources'
    }).pipe(gulp.dest('./dist/ojtranslations/'))

    //Font awesome
    var faCss = gulp.src('src/bower_modules/font-awesome/css/font-awesome.min.css')
            .pipe(replace(/url\((')?\.\.\/fonts\//g, 'url($1fonts/')),
        faFonts = gulp.src('./src/bower_modules/font-awesome/fonts/**/*', {
            base: './src/bower_modules/font-awesome/'
        })

    var combinedCss = es.concat(bowerCss, appCss, faCss).pipe(concat('css.css'))

    return es.concat(combinedCss, ojFonts, faFonts, ojImgFiles, ojImgFilesCommon, ojImgFilesSpecific)
        .pipe(gulp.dest('./dist/'));
});

// Copies index.html, replacing <script> and <link> tags to reference production URLs
gulp.task('html', function() {
    return gulp.src('./src/index.html')
        .pipe(htmlreplace({
            'css': 'css.css',
            'js': 'scripts.js'
        }))
        .pipe(gulp.dest('./dist/'));
});

// Removes all files from ./dist/
gulp.task('clean', function() {
    return gulp.src('./dist/**/*', { read: false })
        .pipe(clean());
});

// Removes all files from ./temp/
gulp.task('clean:temp', function() {
    return gulp.src('./temp/**/*', { read: false })
        .pipe(clean());
});

// Starts a simple static file server that transpiles ES6 on the fly to ES5
gulp.task('serve:src', function() {
    return connect.server({
        root: transpilationConfig.root,
        middleware: function(connect, opt) {
            return [
                 function (req, res, next) {
                     var pathname = path.normalize(url.parse(req.url).pathname);
                     babelTranspile(pathname, function(err, result) {
                        if (err) {
                            next(err);
                        } else if (result) {
                            res.setHeader('Content-Type', 'application/javascript');
                            res.end(result.code);
                        } else {
                            next();
                        }
                     });
                 }
            ];
        }
    });
});

// After building, starts a trivial static file server
gulp.task('serve:dist', ['default'], function() {
    return connect.server({ root: './dist' });
});

function babelTranspile(pathname, callback) {
    if (babelIgnoreRegexes.some(function (re) { return re.test(pathname); })) return callback();
    if (!babelCore.canCompile(pathname)) return callback();
    var src  = path.join(transpilationConfig.root, pathname);
    var opts = objectAssign({ sourceFileName: '/source/' + pathname }, transpilationConfig.babelConfig);
    babelCore.transformFile(src, opts, callback);
}

gulp.task('default', ['html', 'js', 'css'], function(callback) {
    gulp.src('./temp/**/*', { read: false })
        .pipe(clean());
    console.log('\nPlaced optimized files in ' + chalk.magenta('dist/\n'));
    callback()
});
