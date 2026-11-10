> **Need a GUI uploader with full obfuscation?**  
> Check out **Postie** → https://github.com/javi11/postie

### Highlights
- GUI-based uploader
- Full obfuscation support

### Link
- 🔗 **Repository:** https://github.com/javi11/postie

--------

A small variation of Nyuu was the article Obfuscate. 
This fork has the following additional functions:

- Randomize yenc header filename for every article
- Randomize date for every article
- Remove User Agent
- Post to several servers/accounts at once with `--server` (can be repeated)
- `--connection-threads` works with current Node.js versions again; it moves
  connections (including TLS encryption) to worker threads, which helps when the
  upload speed is limited by a single CPU core

In my opinion, this gives you the greatest possible privacy when posting on Usenet.

> [!CAUTION]
> Attention if you use these arguments you can never find again what you have uploaded without the NZB!

Example Arguments for Anonymous Usenet Posting:
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-f "{rand(14)} <{rand(14)}@{rand(5)}.{rand(3)}>" --message-id "{rand(32)}@{rand(8)}.{rand(3)}" --subject "{rand(32)}" --nzb-subject "{filename}" --obfuscate-articles
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
---
Config shortcut (JSON):
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
{
  "obfuscation": true
}
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
This applies the same randomized From/Message-ID/Subject, sets NZB subject to
{filename}, sets NZB poster, and enables --obfuscate-articles.
Hint: If obfuscation is enabled, avoid setting custom From/Message-ID/Subject
or NZB poster/subject overrides, otherwise those values will replace the
randomized obfuscation values.
---

> [!IMPORTANT]  
> [Stop Rar Uploads Deutsch / German](<https://github.com/Antidote2151/Nyuu-Obfuscation/wiki/Stop-RAR-Uploads-Deutsch---German>)
> 
> [Stop Rar Uploads English](<https://github.com/animetosho/Nyuu/wiki/Stop-RAR-Uploads>)

---
Nyuu
====

>   *A powerful beast hidden by a deceptively cute exterior*

Nyuu is a **command-line [binary usenet poster](<https://en.wikipedia.org/wiki/Usenet#Binary_content>)**.

Nyuu is designed primarily to be fast/efficient, reliable and customizable,
exposing all the interesting bits and pieces. From what I’ve seen, Nyuu excels
more than any other usenet posting client in these aspects.

Nyuu runs on top of node.js (which *everyone* knows is [bad ass rock star
tech](https://www.youtube.com/watch?v=bzkRVzciAZg)) with minimal dependencies.
It does require one compiled module,
[yencode](https://github.com/animetosho/node-yencode), for ultra fast yEnc and
CRC32 calculation.

Features
========

**All the standard stuff:** i.e. Nyuu doesn’t miss out on what you need

-   NNTP SSL support

-   yEnc encoding

-   NZB creation, with minification & compression

-   Sub-directory handling

**Fast & efficient:** Nyuu is amongst the fastest (if not [the
fastest](bench/info.md#benchmark-2)) usenet posters, designed to run on low
power, overloaded servers with \>= 1Gbps connections

-   Multiple uploading connections

-   Post checking is asynchronous (minimal impact on speed)

-   Fastest yEnc and CRC32 implementations

-   Buffered async I/O (minimise the effects of slow disks)

-   No temporary files, no disk writes (except for writing the NZB output)

-   No unnecessary disk reads - only performs a single, sequential read pass
    over files

    -   If a post needs to be resubmitted, due to a check failure, and it is not
        cached, it will need to be re-read off disk

    -   PAR2 generation (when integrated) will require an extra initial pass of
        just the first 16KB of each file, and may require multiple read passes
        if all recovery blocks cannot fit in memory

**Reliable:** Nyuu was designed for automation and its reliability requirements

-   Requests are all retryable

-   Able to recover from connection failures/dropouts

-   Timeouts and limits to deal with unexpected server hangs or faults

-   Can selectively skip/ignore some errors

-   Post checking (aka header checks), with multiple attempts and post retrying

-   Unusual or unexpected events are logged

-   Includes some optional workarounds for server bugs

**Highly configurable:** tuning knobs for everything

-   Lots of connection and SSL options

-   NNTP article posting: article/line sizes, header customisation

-   Configure timeouts, delays and error handling parameters

-   NZB meta tags

**Unique features:** the not so usual stuff

-   Pipe input/output from/to processes instead of files, plus the ability to
    pipe out a copy of read input to an external process without incurring
    additional disk reads

-   Extensive upload diagnostic details available (via optional TCP/HTTP status
    server) to help tune settings or find problems

Installation & Requirements
===========================

Pre-Built Binaries
------------------

Static pre-built binaries (built with Node 26) can be found on [the releases
page](https://github.com/Antidote2151/Nyuu-Obfuscation/releases). These can
simply be extracted and run.

### Arch

Archlinux users can install the latest binary-release by installing `nyuu-bin` from the AUR.

*Please note that [this Package](https://aur.archlinux.org/packages/nyuu-bin/) is maintained by a third party and not officially supported. If you have an issue please contact the maintainer.*

Install Via NPM
---------------

If NPM is installed (usually comes bundled with
[node.js](https://nodejs.org/en/download/)), the following command can be used
to install Nyuu:

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
npm install -g nyuu --production
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

You’ll then be able to run Nyuu via the **nyuu** command.

If the **npm** command isn’t available, it can probably be installed via your
package manager (`apt-get install npm` for Debian), or see the following section
titled “Node.js” for more details.

If you get a `gyp ERR! stack Error: EACCES: permission denied` error when installing, try the following command instead:

```
npm install -g nyuu --production --unsafe-perm
```

Note: on some systems, you won’t get an error during installation, but when running Nyuu, it crashes with the error `Error: Cannot find module './build/Release/yencode.node'`. If that is the case, you may need to run the above command to get it to install properly.

You can then later uninstall Nyuu via:

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
npm uninstall -g nyuu
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Install From Source
-------------------

Note that code from Git is considered to be unstable (or rather, less stable
than release versions). Stable packages can be found on [the releases
page](https://github.com/animetosho/Nyuu/releases).

### Node.js

Nyuu should run on node.js 0.10.x and later. Recent Linux distributions should
have *nodejs* in their repositories, otherwise, see [installing via package
manager](https://nodejs.org/en/download/package-manager/) or
[NodeSource](https://github.com/nodesource/distributions). For Windows/OSX
builds, they [can be found here](https://nodejs.org/en/download/stable/).
Although node.js 0.10.x is supported, newer versions of Node (\>=4 recommended)
provide greatly improved SSL performance. Some options need newer versions,
e.g. `--server` requires Node 10 and `--connection-threads` Node 11.7 or later.

### Dependencies

If you have NPM installed (may come with your install of NodeJS, or you may need
to install it like you did with NodeJS if your package system doesn’t include
them together), the following command (executed inside the Nyuu directory) is
all you need to set up the dependencies:

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
npm install --production
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

If you don’t want to use NPM, you can use your package manager instead if it has
all the necessary packages - on Debian 8 / Ubuntu 14.04:

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
apt-get install node-async
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Alternatively, you can grab the dependencies manually: create a directory named
*node_modules* in the Nyuu directory. Inside of which, place
[async](https://github.com/caolan/async/releases).

For yencode, you’ll need to place it in the *node_modules* directory as well,
then follow [the installation
instructions](https://github.com/animetosho/node-yencode).

At the end, the folder structure should resemble something like (not all files
shown):

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Nyuu/
- bin/
- lib/
- node_modules/
  - async/
    - package.json
  - yencode/
    - index.js
package.json
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

### “no suitable image found” error on MacOS 10.15

Due to security changes in OSX 10.15, libraries may require code signing to work. To deal with this, you’ll either need to [disable this security option](https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_security_cs_disable-library-validation?language=objc) or [codesign the built yencode module](https://successfulsoftware.net/2018/11/16/how-to-notarize-your-software-on-macos/). Note that I do not have OSX and can’t provide much support for the platform.

### Executable

Once dependencies have been installed, Nyuu can be run via `node bin/nyuu` or
`nodejs bin/nyuu`. If you wish to just use `nyuu` instead, you need to link to
it from somewhere your *PATH* environment points to. For example, on Linux you
might do

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
ln -s "`pwd`/bin/nyuu.js" /usr/bin/nyuu
chmod a+x bin/nyuu.js
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

(if Node is running via *nodejs* instead of *node*, you can edit the first line
in *bin/nyuu.js* to fix this)

For Windows, you can make a file named *nyuu.cmd* and place it in your system
directory, with the following contents:

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
@"C:\node\node.exe" "C:\path\to\nyuu\bin\nyuu.js" %*
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

(obviously, fix the paths to what they actually are)

Development
===========

Running Tests
-------------

Tests are run via *mocha*, installable via `npm install -g mocha`, and can be
run simply by using the `mocha` command inside Nyuu’s root directory.  
Note that some test cases test functionality of timeouts; to reduce time it
takes to run these tests, timeouts are set relatively small, which means that a
slow computer may not be able to service them as expected.

*test/cli.js* runs the actual command line (`bin/nyuu.js`) against a local test
server and checks the effect of the options in *help-full.txt*: uploaded data,
article headers, NZB contents, console output and exit codes (needs Node 12 or
later, skipped otherwise). When adding or changing an option, add a test there.
On Windows, a test may fail with `EACCES` if its port falls into a range
reserved by Windows; this doesn't affect Nyuu itself.

Benchmarking
------------

*bench/dummy-nntp.js* is a local NNTP(S) server that accepts posts immediately
and discards them, so you can measure Nyuu's own upload speed without a
provider. Start it, then run *bench/local-bench.sh* (see the comments in both
files for options). *bench/stats-preload.js* prints the CPU usage per thread.

Building Binary
---------------

A basic script to compile the Nyuu binary is provided in the *nexe* folder. It builds with NodeJS 26.13.0 by default (set `BUILD_NODEVER` to change it); the release workflow uses the same script.

1. If you haven’t done so already, do an `npm install` in Nyuu’s folder to ensure its dependencies are available
2. Enter the *nexe* folder and do an `npm install` to pull down required build packages (note, nexe requires NodeJS 10 or greater)
3. If desired, edit the variables at the top of *nexe/build.js*
4. Run `node build`. If everything worked, there’ll eventually be a *nyuu* or *nyuu.exe* binary built.
   If it fails during compilation, enter the *nexe/build/26.13.0* (or whatever version of NodeJS you’re using) and get more info by:
   * Linux: build using the `make` command
   * Windows: build using `vcbuild.bat` followed by build options, e.g. `vcbuild nosign x86 noetw intl-none release static no-cctest without-intl ltcg`
5. If building for Linux, optionally `strip` the executable to reduce size

A much faster alternative for test builds is a Node *single executable application* (SEA), which
doesn't compile Node itself. It lives on the `sea` branch: run the *Build dev SEA binaries* workflow
manually and select the `sea` branch. The Linux SEA binary needs glibc and `libatomic` (e.g.
`apt install libatomic1`); release binaries are still built with nexe.

Usage
=====

For command line usage, [see here](help-full.txt), [or here](help.txt) for a
summarized list of options.

Default Configuration
---------------------

As entering long command lines may be tiresome, you may use a config file with
Nyuu via the `--config` or `-C` option. You may use the *config-sample.json*
file as reference to what a config file should be like.

If a config file isn't specified, Nyuu will also search the `NYUU_CONFIG`
environment variable for a default configuration (saving you from needing to
specify this file on every run, if you set the environment up in your shell).

Planned Features
================

-   Integrate [ParPar](https://github.com/animetosho/parpar) for streaming PAR2
    creation

-   Streaming 7-Zip creation

-   Improve multi-server support for both posting and checking

-   Repost missing articles from NZB, and/or some sort of resumption support

-   SOCKS proxy support

-   A web (HTTP) interface would be nice as an alternative to the command line
    interface; not sure if it will be done however

Not planned
-----------

-   RAR support, since 7-Zip should cover everything  

Alternatives
============

A list of Usenet posters I’ve come across can [be found
here](https://github.com/animetosho/Nyuu/wiki/Usenet-Uploaders).

[Here's a benchmark comparison](bench/info.md) between a few of the command line
posters.

License
=======

Nyuu is **Public Domain** or [CC0](https://creativecommons.org/publicdomain/zero/1.0/legalcode) (or equivalent) if PD isn’t recognised. Use her as you will, at your own risk of course
(don’t come back crying if you lose a limb or two).
