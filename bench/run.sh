#!/bin/sh
BASEDIR=~/newsposttest
cd "$BASEDIR"
ULFILE="$BASEDIR/ulfile/data"

BENCH () { /usr/bin/time --verbose $@; rm -f /var/spool/cyrus/mail/t/test/test/[0-9]*; }
# for our benchmarks, we try to warm up interpreters etc before the real deal
WARM () { echo 3 >/proc/sys/vm/drop_caches; $@ >/dev/null 2>/dev/null; }

echo
echo "****************************************"
echo "GoPostStuff (fork) $(go/bin/GoPostStuff --version|sed "s/Version: //") on Go $(go version|grep -oP go[0-9.]+|sed s/go//)"
echo "[No SSL]"
WARM go/bin/GoPostStuff
BENCH go/bin/GoPostStuff -s subj -c gps-nossl.conf "$ULFILE"
echo
echo "[SSL]"
WARM go/bin/GoPostStuff
BENCH go/bin/GoPostStuff -s subj -c gps-ssl.conf "$ULFILE"

echo
echo "****************************************"
cd newsmangler
echo "Newsmangler git-$(git log --max-count=1 --format=%ad --date=short) on $(python --version 2>&1)"
WARM python mangler.py
BENCH python mangler.py -c ../newsmangler-nossl.conf `dirname "$ULFILE"`
cd ..

echo
echo "****************************************"
cd newsmangler2
echo "Newsmangler (fork) git-$(git log --max-count=1 --format=%ad --date=short) on $(python --version 2>&1)"
echo "[No SSL]"
WARM python mangler.py
BENCH python mangler.py -c ../newsmangler-nossl.conf `dirname "$ULFILE"`
echo
echo "[SSL]"
WARM python mangler.py
BENCH python mangler.py -c ../newsmangler-ssl.conf `dirname "$ULFILE"`
cd ..

echo
echo "****************************************"
cd NewsUP
echo "NewsUP git-$(git log --max-count=1 --format=%ad --date=short) on Perl $(perl -v|grep -oP "v[0-9.]+")"
echo "[No SSL]"
WARM perl newsup.pl
BENCH perl newsup.pl -server localhost -port 119 -file "$ULFILE" -connections 4 -news test -username test -password test -uploader a -newsgroup test
echo
echo "[SSL]"
WARM perl newsup.pl
BENCH perl newsup.pl -server localhost -port 563 -file "$ULFILE" -connections 4 -news test -username test -password test -uploader a -newsgroup test
cd ..

echo
echo "****************************************"
cd Nyuu
echo "Nyuu git-$(git log --max-count=1 --format=%ad --date=short) on NodeJS $(nodejs -v)"
echo "[No SSL]"
WARM nodejs bin/nyuu
BENCH nodejs bin/nyuu -h0 -u test -p test -n4 -a 750K -g test "$ULFILE"
echo
echo "[SSL]"
WARM nodejs bin/nyuu
BENCH nodejs bin/nyuu -S -h0 --ignore-cert -u test -p test -n4 -a 750K -g test "$ULFILE"
cd ..

echo
echo "****************************************"
echo "Sanguinews $(sanguinews -V) on $(ruby -v|sed "s/^\(ruby [0-9.]*\).*$/\1/")"
echo "[No SSL]"
#sanguinews' config option doesn't work :(
unlink ~/.sanguinews.conf 2>/dev/null
cp sanguinews-nossl.conf ~/.sanguinews.conf
WARM sanguinews
BENCH sanguinews -f "$ULFILE"
echo
echo "[SSL]"
unlink ~/.sanguinews.conf 2>/dev/null
cp sanguinews-ssl.conf ~/.sanguinews.conf
WARM sanguinews
BENCH sanguinews -c sanguinews-ssl.conf -f "$ULFILE"

echo
echo "****************************************"
echo "Newspost"
WARM newspost
# newspost always has a 3 second delay :/ ?
BENCH newspost -i 0 -u test -p test2 -n test -f a@a -s subj -y -l 17000 -T 0 "$ULFILE"

echo
echo "****************************************"
cd newspost-thread
echo "Newspost - threaded fork"
WARM ./newspost-thread
BENCH ./newspost -i 0 -u test -p test2 -n test -f a@a -s subj -l 6000 -T 0 -N 4 "$ULFILE"
cd ..
