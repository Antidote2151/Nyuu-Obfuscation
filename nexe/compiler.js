"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const buffer_1 = require("buffer");
const fs_1 = require("fs");
const child_process_1 = require("child_process");
const logger_1 = require("./logger");
const util_1 = require("./util");
const options_1 = require("./options");
const MultiStream = require("multistream");
const bundle_1 = require("./fs/bundle");
const isBsd = Boolean(~process.platform.indexOf('bsd'));
const make = util_1.isWindows ? 'vcbuild.bat' : isBsd ? 'gmake' : 'make';
const configure = util_1.isWindows ? 'configure' : './configure';
class NexeError extends Error {
    constructor(m) {
        super(m);
        Object.setPrototypeOf(this, NexeError.prototype);
    }
}
exports.NexeError = NexeError;
class NexeCompiler {
    constructor(options) {
        this.options = options;
        /**
         * Epoch of when compilation started
         */
        this.start = Date.now();
        this.log = new logger_1.Logger(this.options.loglevel);
        /**
         * Copy of process.env
         */
        this.env = Object.assign({}, process.env);
        /**
         * In memory files that are being manipulated by the compiler
         */
        this.files = [];
        /**
         * Standalone pieces of code run before the application entrypoint
         */
        this.shims = [];
        /**
         * The last shim (defaults to "require('module').runMain()")
         */
        this.startup = '';
        /**
         * Output filename (-o myapp.exe)
         */
        this.output = this.options.output;
        /**
         * Flag to indicate whether or notstdin was used for input
         */
        this.stdinUsed = false;
        const { python } = (this.options = options);
        //SOMEDAY iterate over multiple targets with `--outDir`
        this.targets = options.targets;
        this.target = this.targets[0];
        if (!(options.remote.startsWith('http://') ||
            options.remote.startsWith('https://') ||
            options.remote.startsWith('file://'))) {
            throw new NexeError(`Invalid remote URI scheme (must be http, https, or file): ${options.remote}`);
        }
        this.remoteAsset = options.remote + this.target.toString();
        this.src = path_1.join(this.options.temp, this.target.version);
        this.configureScript = configure + (util_1.semverGt(this.target.version, '10.10.0') ? '.py' : '');
        this.nodeSrcBinPath = util_1.isWindows
            ? path_1.join(this.src, 'Release', 'node.exe')
            : path_1.join(this.src, 'out', 'Release', 'node');
        this.log.step('nexe ' + options_1.version, 'info');
        this.bundle = new bundle_1.Bundle(options);
        if (util_1.isWindows) {
            const originalPath = process.env.PATH;
            delete process.env.PATH;
            this.env = Object.assign({}, process.env);
            this.env.PATH = python
                ? (this.env.PATH = util_1.dequote(path_1.normalize(python)) + path_1.delimiter + originalPath)
                : originalPath;
            process.env.PATH = originalPath;
        }
        else {
            this.env = Object.assign({}, process.env);
            python && (this.env.PYTHON = python);
        }
    }
    addResource(absoluteFileName, content) {
        return this.bundle.addResource(absoluteFileName, content);
    }
    readFileAsync(file) {
        return __awaiter(this, void 0, void 0, function* () {
            this.assertBuild();
            let cachedFile = this.files.find((x) => path_1.normalize(x.filename) === path_1.normalize(file));
            if (!cachedFile) {
                const absPath = path_1.join(this.src, file);
                cachedFile = {
                    absPath,
                    filename: file,
                    contents: yield util_1.readFileAsync(absPath, 'utf-8').catch((x) => {
                        if (x.code === 'ENOENT')
                            return '';
                        throw x;
                    }),
                };
                this.files.push(cachedFile);
            }
            return cachedFile;
        });
    }
    writeFileAsync(file, contents) {
        this.assertBuild();
        return util_1.writeFileAsync(path_1.join(this.src, file), contents);
    }
    replaceInFileAsync(file, replace, value) {
        return __awaiter(this, void 0, void 0, function* () {
            const entry = yield this.readFileAsync(file);
            entry.contents = entry.contents.toString().replace(replace, value);
        });
    }
    setFileContentsAsync(file, contents) {
        return __awaiter(this, void 0, void 0, function* () {
            const entry = yield this.readFileAsync(file);
            entry.contents = contents;
        });
    }
    quit(error) {
        const time = Date.now() - this.start;
        this.log.write(`Finished in ${time / 1000}s`, error ? 'red' : 'green');
        return this.log.flush();
    }
    assertBuild() {
        if (!this.options.build) {
            throw new NexeError('This feature is only available with `--build`');
        }
    }
    getNodeExecutableLocation(target) {
        if (target) {
            return path_1.join(this.options.temp, target.toString());
        }
        return this.nodeSrcBinPath;
    }
    _runBuildCommandAsync(command, args) {
        if (this.log.verbose) {
            this.compileStep.pause();
        }
        return new Promise((resolve, reject) => {
            child_process_1.spawn(command, args, {
                shell: true,
                cwd: this.src,
                env: this.env,
                stdio: this.log.verbose ? 'inherit' : 'ignore',
            })
                .once('error', (e) => {
                if (this.log.verbose) {
                    this.compileStep.resume();
                }
                reject(e);
            })
                .once('close', (code) => {
                if (this.log.verbose) {
                    this.compileStep.resume();
                }
                if (code != 0) {
                    const error = `${command} ${args.join(' ')} exited with code: ${code}`;
                    reject(new NexeError(error));
                }
                resolve();
            });
        });
    }
    _configureAsync() {
        if (util_1.isWindows && util_1.semverGt(this.target.version, '10.15.99')) {
            return Promise.resolve();
        }
        return this._runBuildCommandAsync(this.env.PYTHON || 'python', [
            this.configureScript,
            ...this.options.configure,
        ]);
    }
    build() {
        return __awaiter(this, void 0, void 0, function* () {
            this.compileStep.log(`Configuring node build${this.options.configure.length ? ': ' + this.options.configure : '...'}`);
            yield this._configureAsync();
            const buildOptions = this.options.make;
            this.compileStep.log(`Compiling Node${buildOptions.length ? ' with arguments: ' + buildOptions : '...'}`);
            yield this._runBuildCommandAsync(make, buildOptions);
            return fs_1.createReadStream(this.getNodeExecutableLocation());
        });
    }
    _shouldCompileBinaryAsync(binary, location) {
        return __awaiter(this, void 0, void 0, function* () {
            //SOMEDAY combine make/configure/vcBuild/and modified times of included files
            const { snapshot, build } = this.options;
            if (!binary) {
                return true;
            }
            if (build && snapshot != null && (yield util_1.pathExistsAsync(snapshot))) {
                const snapshotLastModified = (yield util_1.statAsync(snapshot)).mtimeMs;
                const binaryLastModified = (yield util_1.statAsync(location)).mtimeMs;
                return snapshotLastModified > binaryLastModified;
            }
            return false;
        });
    }
    compileAsync(target) {
        return __awaiter(this, void 0, void 0, function* () {
            const step = (this.compileStep = this.log.step('Compiling result'));
            const build = this.options.build;
            const location = this.getNodeExecutableLocation(build ? undefined : target);
            let binary = (yield util_1.pathExistsAsync(location)) ? fs_1.createReadStream(location) : null;
            if (yield this._shouldCompileBinaryAsync(binary, location)) {
                binary = yield this.build();
                step.log('Node binary compiled');
            }
            return this._assembleDeliverable(binary);
        });
    }
    code() {
        return [this.shims.join(''), this.startup].join(';');
    }
    _assembleDeliverable(binary) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.options.mangle) {
                return binary;
            }
            const resources = this.bundle.renderIndex();
            this.shims.unshift(util_1.wrap(`process.__nexe = ${JSON.stringify({ resources })};\n`));
            const code = this.code(), codeSize = buffer_1.Buffer.byteLength(code), lengths = buffer_1.Buffer.from(Array(16));
            lengths.writeDoubleLE(codeSize, 0);
            lengths.writeDoubleLE(this.bundle.size, 8);
            return new MultiStream([
                binary,
                bundle_1.toStream(code),
                this.bundle.toStream(),
                bundle_1.toStream(buffer_1.Buffer.concat([buffer_1.Buffer.from('<nexe~~sentinel>'), lengths])),
            ]);
        });
    }
}
__decorate([
    util_1.bound
], NexeCompiler.prototype, "addResource", null);
__decorate([
    util_1.bound
], NexeCompiler.prototype, "readFileAsync", null);
__decorate([
    util_1.bound
], NexeCompiler.prototype, "writeFileAsync", null);
__decorate([
    util_1.bound
], NexeCompiler.prototype, "replaceInFileAsync", null);
__decorate([
    util_1.bound
], NexeCompiler.prototype, "setFileContentsAsync", null);
exports.NexeCompiler = NexeCompiler;
