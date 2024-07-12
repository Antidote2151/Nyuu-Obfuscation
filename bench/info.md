Here are some rushed and unscientific benchmarks of a few command line binary
Usenet posters.  
I did this because I couldn't find anything like this out there and it provides
a rough idea of where Nyuu stands amongst the rest. But if anyone has the time
to do better benchmarks, please do submit a pull request!

Test was done on a Scaleway trial VPS with 2x Atom C2750 CPU cores, 2GB RAM,
50GB SSD, running Ubuntu 15.10 amd64 (with 16.04 packages). To avoid variations
caused by the network, uploading was done to a local install of cyrus-nntpd on
the same machine. The news folder was mounted on a RAM disk to get rid of disk
bottlenecks on the server. See details below on how to replicate these
benchmarks.

Only a single 256MB file was uploaded, containing random data. Disk buffers were
flushed before each test.

Settings were generally left at default, with minimal changes to get things
working. General changes:

-   number of connections = 4

-   article size: 768000 bytes

-   SSL, both on/off tested

-   in general, anything unnecessary was disabled if the option was avilable,
    such as NZB output and header checking

Speeds were obtained using the [time
utility](<http://man7.org/linux/man-pages/man1/time.1.html>). CPU speed is 256MB
divided by the sum of the user and system time. Overall speed is 256MB divided
by the total process time.

Applications Tested
-------------------

At time of writing, these are the latest versions of the respective
applications, along with interpreters/runtimes available in the Ubuntu 16.04
repositories.

-   GoPostStuff, engine9tm’s fork (git 2016-04-02) on Go 1.6.1

    -   The fork was used as the original no longer builds (dependency reference
        issue) without modification

-   Newsmangler (git 2014-01-01) on Python 2.7.11 + yenc-vanilla

    -   This original version doesn’t support SSL (the fork below does)

-   Newsmangler, nicors57's fork (git 2016-03-25) on Python 2.7.11 +
    yenc-vanilla

-   NewsUP (git 2016-04-27) on Perl 5.22.1

-   Nyuu (git 2016-05-01) on NodeJS 4.2.6

-   Sanguinews 0.80.1 on Ruby 2.3.0

-   Newspost 2.1.1

    -   This is an old application, which doesn’t support many features
        (including SSL) that newer posters do, mostly used here as a reference
        point

    -   There is usually a forced 3 second delay for posting, which was removed
        for this benchmark

-   Newspost, PietjeBell88’s fork (git 2010-05-10)

    -   Like the original Newpost, but with threading

Results
-------

![](<no-ssl.png>)

![](<ssl.png>)

![](<rss.png>)

Observations
------------

-   The old Newspost doesn't support multiple connections, so (performance wise)
    generally falls behind the more modern clients that do. However, the
    threaded fork makes up for this. It’s memory footprint is miniscule compared
    to what we have today, though the difference may not matter so much
    nowadays. As this was mostly for reference purposes, the following points
    won't discuss this client.

-   Results for Sanguinews seems unusually slow. I don’t know what the reason
    for this is, but if anyone knows, please do tell. Regardless, the following
    statements will ignore these results

-   Posting speed between the newer applications are fairly similar at 4
    connections. All these should be able to push 100Mbps, even on a low power
    CPU.

-   GoPostStuff's memory usage seems to indicate that it may be loading the
    entire file into memory (mmap?)

-   I believe that none of the applications above implement their own SSL,
    defering this to other libraries, hence SSL benchmarks aren’t so reflective
    of the client, but may be more realistic if that’s your goal. Also, SSL
    cipher selection is not explored, although only Nyuu provides the ability to
    change away from the default cipher.

-   Nyuu's CPU usage is the lowest, thanks to the highly optimized yEnc and CRC
    implementation on x86.

-   Other than Nyuu, I’d recommend (the relatively new) NewsUP from these
    results. It performs well and is still under active development.

Running Benchmarks
------------------

These benchmarks have been run on a free trial VPS from Scaleway. You can get a
[20 minute trial here](<http://instantcloud.io/>). Or you can use some other
Debian/Ubuntu server if you don’t mind having random things installed (i.e. your
system broken), and don’t mind potentially needing to edit the script for it to
work.

Once you have a shell on a test server (make sure you’re root), installing
everything can be done by:

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
wget https://raw.githubusercontent.com/animetosho/Nyuu/master/bench/setup.sh -O-|sh
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

**You’ll get prompted during the install** - just hit Enter a few times for the
script to continue. The script will generate a 256MB test file; a larger test
file is better, but makes it difficult to complete during the 20 minute trial.
If you want a larger file, edit the last line in the script appropriately. On
the Scaleway VPS, setup takes around 5 minutes.

Once installed, run the benchmarks

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
wget https://raw.githubusercontent.com/animetosho/Nyuu/master/bench/run.sh -O-|sh
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

This will output all the results, which you can save a copy of (if you wish,
replace `sh` with `sh 2>&1|tee run.log` to log output to a file).
