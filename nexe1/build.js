var nodeVer = '8.17.0';
var nexeBase = '.';
var nodeSrc = nexeBase + '/node/' + nodeVer + '/_/'; // TODO: auto search folder
var yencSrc = './yencode-src/';
var python = 'python';
// process.env.path = '' + process.env.path; // if need to specify a Python path
var makeArgs = ["-j", "1"];
var vcBuildArch = "x86"; // x86 or x64
var useLTO = true;
var oLevel = '-O2'; // prefer -O2 on GCC, -Os on Clang
var isaBaseFlag = ',"-msse2"'; // set to blank for non-x86 targets

var fs = require('fs');
var nexe = require('nexe');

var isNode010 = !!nodeVer.match(/^0\.10\./);
var ltoFlag = useLTO ? '"-flto"' : '';
var ltoFlagC = useLTO ? ',"-flto"' : '';
var modulePref = isNode010?'node_':'';
fs.statSync(yencSrc + 'yencode.cc'); // trigger error if it doesn't exist

// TODO: fix issue with workerthreads in node < 10

var path = require('path');
var copyRecursiveSync = function(src, dest) {
	if(fs.statSync(src).isDirectory()) {
		if(!fs.existsSync(dest)) fs.mkdirSync(dest);
		fs.readdirSync(src).forEach(function(child) {
			copyRecursiveSync(path.join(src, child), path.join(dest, child));
		});
	} else
		fs.copyFileSync(src, dest);
};

var gypParse = function(gyp) {
	// very hacky fixes for Python's flexibility
	gyp = gyp.replace(/'(\s*\n\s*')/g, "' +$1");
	gyp = gyp.replace(/#[^'"]*?(\r?\n)/g, "$1");
	gyp = gyp.replace(/(\n\s*)#.*?(\r?\n)/g, "$1$2");
	gyp = gyp.replace(/(\n\s*)#.*?(\r?\n)/g, "$1$2");
	gyp = gyp.replace(/(\n\s*)#.*?(\r?\n)/g, "$1$2");
	gyp = gyp.replace(/(\n\s*)#.*?(\r?\n)/g, "$1$2");
	return eval('(' + gyp + ')');
};
// monkey patch node.gyp
var gypData = fs.readFileSync(nodeSrc + 'node.gyp').toString();
var gyp = gypParse(gypData);


var findGypTarget = function(targ) {
	for(var i in gyp.targets)
		if(gyp.targets[i].target_name == targ)
			return gyp.targets[i];
	return false;
};

// changing the GYP too much breaks nexe, so resort to monkey-patching it

var doPatch = function(r, s, ignoreMissing) {
	var m = gypData.match(r);
	if(!m) {
		if(ignoreMissing) return;
		throw new Error('Could not match ' + r);
	}
	if(!r.global && gypData.substr(m.index+1).match(r))
		throw new Error('Expression matched >1 times: ' + r);
	gypData = gypData.replace(r, '$1 ' + s);
};
if(!findGypTarget('crcutil')) {
	// TODO: update this to enable building yencode 1.1.0
	doPatch(/(\},\s*['"]targets['"]: \[)/, JSON.stringify({
	      "target_name": "crcutil",
	      "type": "static_library",
	      "sources": [
	        "crcutil-1.0/code/crc32c_sse4.cc",
	        "crcutil-1.0/code/multiword_64_64_cl_i386_mmx.cc",
	        "crcutil-1.0/code/multiword_64_64_gcc_amd64_asm.cc",
	        "crcutil-1.0/code/multiword_64_64_gcc_i386_mmx.cc",
	        "crcutil-1.0/code/multiword_64_64_intrinsic_i386_mmx.cc",
	        "crcutil-1.0/code/multiword_128_64_gcc_amd64_sse2.cc",
	        "crcutil-1.0/examples/interface.cc"
	      ],
	      "conditions": [
	        ['OS=="win"', {
	          "msvs_settings": {"VCCLCompilerTool": {"EnableEnhancedInstructionSet": "2", "Optimization": "MaxSpeed", "BufferSecurityCheck": "false"}}
	        }, {
	          "cxxflags": ["-O3", "-fomit-frame-pointer"],
	          "cxxflags!": ["-fno-omit-frame-pointer", "-fno-tree-vrp", "-fno-strict-aliasing"]
	        }],
	        // some of the ASM won't compile with LTO, so disable it for CRCUtil
	        ['target_arch == "ia32"', {
	          "cflags!": ['-flto'],
	          "cxxflags!": ['-flto'],
	        }, {
	          "cxxflags": ['-flto'],
	        }],
	        ['target_arch in "ia32 x64"', {
	          "cxxflags": ["-msse2"],
	          "xcode_settings": {"OTHER_CXXFLAGS": ["-msse2"]}
	        }]
	      ],
	      "include_dirs": ["crcutil-1.0/code", "crcutil-1.0/tests"],
	      "defines": ["CRCUTIL_USE_MM_CRC32=0"]
	})+',');
}

var tNode = findGypTarget('<(node_lib_target_name)');
var tNodeM = "['\"]target_name['\"]:\\s*['\"]<\\(node_lib_target_name\\)['\"],";
if(!tNode) {
	tNode = findGypTarget('<(node_core_target_name)');
	tNodeM = "['\"]target_name['\"]:\\s*['\"]<\\(node_core_target_name\\)['\"],";
}
if(!tNode) {
	tNode = findGypTarget('node');
	tNodeM = "['\"]target_name['\"]:\\s*['\"]node['\"],";
}
var tNodeMatch = new RegExp('('+tNodeM+')');
if(tNode.sources.indexOf('src/'+modulePref+'yencode.cc') < 0)
	doPatch(/(['"]src\/node_file\.cc['"],)/, "'src/"+modulePref+"yencode.cc',");
if(tNode.dependencies.indexOf('crcutil') < 0) {
	if(tNode.dependencies.indexOf('deps/histogram/histogram.gyp:histogram') == 0)
		// Node 12
		// TODO: this gets double-replaced if run twice
		doPatch(/('src\/node_main\.cc'[^]{2,50}'dependencies': \[ 'deps\/histogram\/histogram\.gyp:histogram')/, ",'crcutil'");
	else
		// try to avoid matching the cctest target
		doPatch(/('target_name': '<\([^\]]+?['"]node_js2c#host['"],)/, "'crcutil',");
}
if(tNode.include_dirs.indexOf('crcutil-1.0/code') < 0)
	doPatch(/(['"]<\(SHARED_INTERMEDIATE_DIR\)['"])(,?) # for node_natives\.h\r?\n/g, ",'crcutil-1.0/code', 'crcutil-1.0/examples'$2");

if(gyp.variables.library_files.indexOf('lib/yencode.js') < 0)
	doPatch(/(['"]lib\/fs\.js['"],)/, "'lib/yencode.js',");

// disable cctest
var tCCT = findGypTarget('cctest');
if(tCCT && tCCT.type == 'executable')
	doPatch(/(['"]target_name['"]:\s*['"]cctest['"],\s*['"]type['"]:\s*)['"]executable['"]/, "'none'");

// urgh, copy+paste :/
if(!tNode.msvs_settings) {
	doPatch(tNodeMatch, "'msvs_settings': {'VCCLCompilerTool': {'EnableEnhancedInstructionSet': '2', 'FavorSizeOrSpeed': '2'}, 'VCLinkerTool': {'GenerateDebugInformation': 'false'}},");
} else {
	if(!tNode.msvs_settings.VCCLCompilerTool) {
		doPatch(new RegExp("(" + tNodeM + "[^]*?['\"]msvs_settings['\"]:\\s*\\{)"), "'VCCLCompilerTool': {'EnableEnhancedInstructionSet': '2', 'FavorSizeOrSpeed': '2'},");
	} else if(!tNode.msvs_settings.VCCLCompilerTool.EnableEnhancedInstructionSet) {
		doPatch(/(['"]VCCLCompilerTool['"]:\s*\{)/, "'EnableEnhancedInstructionSet': '2', 'FavorSizeOrSpeed': '2',");
	}
	
	if(!tNode.msvs_settings.VCLinkerTool) {
		doPatch(new RegExp("(" + tNodeM + "[^]*?['\"]msvs_settings['\"]:\\s*\\{)"), "'VCLinkerTool': {'GenerateDebugInformation': 'false'},");
	} else if(!tNode.msvs_settings.VCLinkerTool.GenerateDebugInformation) {
		doPatch(/(['"]VCLinkerTool['"]:\s*\{)/, "'GenerateDebugInformation': 'false',");
	}
}
var patchTargetFlags = function(node, regex) {
	var match = new RegExp('('+regex+')');
	if(!node.cxxflags) {
		doPatch(match, "'cxxflags': ['"+oLevel+"'"+isaBaseFlag+ltoFlagC+"],");
	} else if(node.cxxflags.indexOf(oLevel) < 0) {
		doPatch(new RegExp("(" + regex + "[^]*?['\"]cxxflags['\"]:\\s*\\[)"), "'"+oLevel+"'"+isaBaseFlag+ltoFlagC+",");
	}
	
	if(!node.ldflags) {
		doPatch(match, "'ldflags': ['-s'"+ltoFlagC+"],");
	} else if(node.ldflags.indexOf('-s') < 0) {
		doPatch(new RegExp("(" + regex + "[^]*?['\"]ldflags['\"]:\\s*\\[)"), "'-s'"+ltoFlagC+",");
	}
};
patchTargetFlags(tNode, tNodeM);
if(tNodeM.indexOf('node_lib_target_name')) {
	// needed in node v8.x?
	var tNodeExe = findGypTarget('<(node_core_target_name)');
	if(tNodeExe)
		patchTargetFlags(tNodeExe, "['\"]target_name['\"]:\\s*['\"]<\\(node_core_target_name\\)['\"],");
}

// strip OpenSSL exports
doPatch(/('use_openssl_def%?':) 1,/, "0,", true);


fs.writeFileSync(nodeSrc + 'node.gyp', gypData);


// patch manifest
var pkg = require('../package.json');
var manif = fs.readFileSync(nodeSrc + 'src/res/node.rc').toString();
manif = manif
.replace(/1 ICON node\.ico/, '')
.replace(/VALUE "CompanyName", "[^"]+"/, '')
.replace(/VALUE "ProductName", "[^"]+"/, 'VALUE "ProductName", "' + pkg.name + '"')
.replace(/VALUE "FileDescription", "[^"]+"/, 'VALUE "FileDescription", "' + pkg.description + '"')
.replace(/VALUE "FileVersion", NODE_EXE_VERSION/, 'VALUE "FileVersion", "' + pkg.version + '"')
.replace(/VALUE "ProductVersion", NODE_EXE_VERSION/, 'VALUE "ProductVersion", "' + pkg.version + '"')
.replace(/VALUE "InternalName", "[^"]+"/, 'VALUE "InternalName", "nyuu"');
fs.writeFileSync(nodeSrc + 'src/res/node.rc', manif);


var patchGypCompiler = function(file, targets) {
	// require SSE2; TODO: tweak this?
	var gypData = fs.readFileSync(nodeSrc + file).toString();
	var gyp = gypParse(gypData);
	
	if(!gyp.target_defaults) {
		targets = targets || 'targets';
		gypData = gypData.replace("'"+targets+"':", "'target_defaults': {'msvs_settings': {'VCCLCompilerTool': {'EnableEnhancedInstructionSet': '2', 'FavorSizeOrSpeed': '2'}, 'VCLinkerTool': {'GenerateDebugInformation': 'false'}}, 'cxxflags': ['"+oLevel+"'"+isaBaseFlag+ltoFlagC+"], 'ldflags': ['-s'"+ltoFlagC+"]}, '"+targets+"':");
	} else {
		// TODO: other possibilities
		if(!gyp.target_defaults.msvs_settings)
			gypData = gypData.replace("'target_defaults': {", "'target_defaults': {'msvs_settings': {'VCCLCompilerTool': {'EnableEnhancedInstructionSet': '2', 'FavorSizeOrSpeed': '2'}, 'VCLinkerTool': {'GenerateDebugInformation': 'false'}},");
		else if(!gyp.target_defaults.msvs_settings.VCCLCompilerTool || !gyp.target_defaults.msvs_settings.VCLinkerTool || !gyp.target_defaults.msvs_settings.VCCLCompilerTool.EnableEnhancedInstructionSet)
			throw new Error('To be implemented');
		if(!gyp.target_defaults.cxxflags)
			gypData = gypData.replace("'target_defaults': {", "'target_defaults': {'cxxflags': ['"+oLevel+"'"+isaBaseFlag+ltoFlagC+"],");
		else if(useLTO && gyp.target_defaults.cxxflags.indexOf('-flto') < 0)
			throw new Error('To be implemented');
		if(!gyp.target_defaults.ldflags)
			gypData = gypData.replace("'target_defaults': {", "'target_defaults': {'ldflags': ['-s'"+ltoFlagC+"],");
		else if(useLTO && gyp.target_defaults.ldflags.indexOf('-flto') < 0)
			throw new Error('To be implemented');
	}
	
	fs.writeFileSync(nodeSrc + file, gypData);
};

//patchGypCompiler('node.gyp');
patchGypCompiler('deps/cares/cares.gyp');
//patchGypCompiler('deps/http_parser/http_parser.gyp');
patchGypCompiler('deps/openssl/openssl.gyp');
patchGypCompiler('deps/uv/uv.gyp');
patchGypCompiler('deps/zlib/zlib.gyp', 'conditions');
// node 12's v8 doesn't use gyp
if(fs.existsSync(nodeSrc + 'deps/v8/src/v8.gyp'))
	patchGypCompiler('deps/v8/src/v8.gyp');
else if(fs.existsSync(nodeSrc + 'deps/v8/tools/gyp/v8.gyp'))
	patchGypCompiler('deps/v8/tools/gyp/v8.gyp');



var patchFile = function(path, find, replFrom, replTo) {
	var ext = fs.readFileSync(nodeSrc + path).toString();
	if(!find || (find.test ? !find.test(ext) : ext.indexOf(find) < 0)) {
		ext = ext.replace(replFrom, replTo);
		fs.writeFileSync(nodeSrc + path, ext);
	}
};

// TODO: improve placement of ldflags
patchFile('common.gypi', null, "'cflags': [ '-O3',", (useLTO ? "'ldflags': ['-flto'], ":'')+"'cflags': [ '"+oLevel+"'"+isaBaseFlag+ltoFlagC+",");
patchFile('common.gypi', null, "'FavorSizeOrSpeed': 1,", "'FavorSizeOrSpeed': 2, 'EnableEnhancedInstructionSet': '2',");
patchFile('common.gypi', null, "'GenerateDebugInformation': 'true',", "'GenerateDebugInformation': 'false',");

// TODO: set AR=gcc-ar if ar fails

if(fs.existsSync(nodeSrc + 'src/node_extensions.h')) { // node 0.10.x
	patchFile('src/node_extensions.h', 'yencode', '\nNODE_EXT_LIST_START', '\nNODE_EXT_LIST_START\nNODE_EXT_LIST_ITEM('+modulePref+'yencode)');
}
if(nodeVer.startsWith('8.')) { // doesn't work for node 4 or 12, but does for 8
	patchFile('src/node_internals.h', 'V(yencode)', 'V(async_wrap)', 'V(yencode) V(async_wrap)');
	// nexe fails to patch the new code, so we'll do it ourself
	patchFile('lib/internal/bootstrap_node.js', '"nexe.js"', 'function startup() {', 'if (process.argv[1] !== "nexe.js") process.argv.splice(1, 0, "nexe.js");\n  function startup() {\n    process._eval = NativeModule.getSource("nexe");');
}

// strip exports
patchFile('src/node.h', null, 'define NODE_EXTERN __declspec(dllexport)', 'define NODE_EXTERN');
patchFile('src/node.h', null, 'define NODE_MODULE_EXPORT __declspec(dllexport)', 'define NODE_MODULE_EXPORT');
patchFile('src/node_api.h', null, 'define NAPI_EXTERN __declspec(dllexport)', 'define NAPI_EXTERN');
patchFile('src/node_api.h', null, 'define NAPI_MODULE_EXPORT __declspec(dllexport)', 'define NAPI_MODULE_EXPORT');
patchFile('common.gypi', null, /'BUILDING_(V8|UV)_SHARED=1',/g, '');
fs.writeFileSync(nodeSrc + 'deps/zlib/win32/zlib.def', 'EXPORTS');

// create embeddable help
fs.writeFileSync('../bin/help.json', JSON.stringify({
	full: fs.readFileSync('../help-full.txt').toString(),
	short: fs.readFileSync('../help.txt').toString()
}));


// copy yencode sources across
var copyCC = function(src, dest) {
	var code = fs.readFileSync(src).toString();
	if(isNode010)
		code = code.replace(/NODE_MODULE\(([a-z0-9_]+)/, 'NODE_MODULE('+modulePref+'$1');
	else if(parseFloat(nodeVer) >= 8)
		code = code.replace('NODE_MODULE(', '#include "'+dest.replace(/\/[^\/]+$/, '/src').replace(/[^\/]+\//g, '../') + '/node_internals.h"' + '\r\n' + 'NODE_BUILTIN_MODULE_CONTEXT_AWARE(');
	else
		code = code.replace('NODE_MODULE(', 'NODE_MODULE_CONTEXT_AWARE_BUILTIN(');
	if(dest.substr(0, 3) != '../')
		dest = nodeSrc + dest;
	fs.writeFileSync(dest, code);
};
var copyJS = function(src, dest) {
	var code = fs.readFileSync(src).toString();
	code = code.replace(/require\(['"][^'"]*\/([0-9a-z_]+)\.node'\)/g, "process.binding('$1')");
	if(dest.substr(0, 3) != '../')
		dest = nodeSrc + dest;
	fs.writeFileSync(dest, code);
};
copyCC(yencSrc + 'yencode.cc', 'src/'+modulePref+'yencode.cc');
copyJS(yencSrc + 'index.js', 'lib/yencode.js');

fs.readdirSync(yencSrc).forEach(function(f) {
	if(f == 'yencode.cc' || f == 'index.js' || f.match(/^test/)) return;
	
	var dst;
	if(f.match(/\.(c|cpp|cc|h)$/))
		dst = 'src/' + f;
	else if(f.match(/\.js$/))
		dst = 'lib/' + f;
	
	if(dst) {
		fs.writeFileSync(nodeSrc + dst, fs.readFileSync(yencSrc + f));
	}
});
copyRecursiveSync(yencSrc + 'crcutil-1.0', nodeSrc + 'crcutil-1.0');


// now run nexe
// TODO: consider building startup snapshot?
// note: on alpine, need to run `paxmark -m out/Release/mksnapshot` first and maybe `paxmark -m out/Release/node` at the end; see https://github.com/alpinelinux/aports/blob/master/main/nodejs/APKBUILD

nexe.compile({
    input: '../bin/nyuu.js', // where the input file is
    output: './nyuu' + (require('os').platform() == 'win32' ? '.exe':''), // where to output the compiled binary
    nodeVersion: nodeVer, // node version
    nodeTempDir: nexeBase, // where to store node source.
    // --without-snapshot
    nodeConfigureArgs: ['--fully-static', '--without-dtrace', '--without-etw', '--without-perfctr', '--without-npm', '--with-intl=none', '--dest-cpu=' + vcBuildArch], // for all your configure arg needs.
    nodeMakeArgs: makeArgs, // when you want to control the make process.
    nodeVCBuildArgs: ["nosign", vcBuildArch, "noetw", "noperfctr", "intl-none"], // when you want to control the make process for windows.
                                        // By default "nosign" option will be specified
                                        // You can check all available options and its default values here:
                                        // https://github.com/nodejs/node/blob/master/vcbuild.bat
    python: python, // for non-standard python setups. Or python 3.x forced ones.
    resourceFiles: [  ], // array of files to embed.
    resourceRoot: [  ], // where to embed the resourceFiles.
    flags: true, // use this for applications that need command line flags.
    jsFlags: "", // v8 flags
    startupSnapshot: null, // when you want to specify a script to be
                                            // added to V8's startup snapshot. This V8
                                            // feature deserializes a heap to save startup time.
                                            // More information in this blog post:
                                            // http://v8project.blogspot.de/2015/09/custom-startup-snapshots.html
    framework: "node", // node, nodejs, or iojs
    
    browserifyExcludes: ['yencode','xz','../node_modules/xz/package.json','iltorb','../node_modules/iltorb/package.json']
}, function(err) {
    if(err) {
        return console.log(err);
    }
    
    console.log('done');
    fs.unlinkSync('../bin/help.json');
    
    // paxmark -m nyuu
    // tar --group=nobody --owner=nobody -cf nyuu-v0.3.8-linux-x86-sse2.tar nyuu ../config-sample.json
    // xz -9e --x86 --lzma2 *.tar
    
});
