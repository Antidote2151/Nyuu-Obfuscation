#!/bin/sh
BASEDIR=~/newsposttest

mkdir -p "$BASEDIR"
cd "$BASEDIR"

# since we're on 15.10, and don't really have time to upgrade to 16.04, just pull some packages and make a hybrid system
echo "deb http://archive.ubuntu.com/ubuntu xenial main universe" >>/etc/apt/sources.list
apt-get update

# APT deps
apt-get update # may be needed to refresh stuff
apt-get install -y perl python
apt-get install -y python-openssl
apt-get install -y ruby rubygems ruby-dev build-essential git golang python-dev nodejs npm time cpanminus

# Python yEnc
wget "https://bitbucket.org/dual75/yenc/get/tip.tar.gz"
mv *.tar.gz yenc.tar.gz
tar zxf yenc.tar.gz
cd dual75-yenc-*
python setup.py build
python setup.py install
cd ..

# Cyrus
apt-get install -y --no-install-recommends cyrus-nntpd cyrus-admin cyrus-imapd sasl2-bin # causes 2 prompts to come up :/
sed "s/#nntps/nntps/" /etc/cyrus.conf > /etc/cyrus-tmp.conf
unlink /etc/cyrus.conf
mv /etc/cyrus-tmp.conf /etc/cyrus.conf

echo "admins: cyrus" >>/etc/imapd.conf
echo "newsprefix: test" >>/etc/imapd.conf
sed "s/^sasl_pwcheck_method:/sasl_pwcheck_method: alwaystrue/" /etc/imapd.conf > /etc/imapd-tmp.conf
unlink /etc/imapd.conf
mv /etc/imapd-tmp.conf /etc/imapd.conf

# generate SSL cert
openssl req -new -nodes -out req.pem -keyout key.pem <<EOF









EOF
openssl rsa -in key.pem -out new.key.pem
openssl x509 -in req.pem -out ca-cert -req -signkey new.key.pem -days 999
cat new.key.pem ca-cert >server.pem
mv server.pem /tmp
chown cyrus:mail /tmp/server.pem
echo tls_ca_file: /tmp/server.pem >> /etc/imapd.conf
echo tls_cert_file: /tmp/server.pem >> /etc/imapd.conf
echo tls_key_file: /tmp/server.pem >> /etc/imapd.conf

service cyrus-imapd restart
sed "s/^START=no/START=yes/" /etc/default/saslauthd > /etc/default/saslauthd.tmp
unlink /etc/default/saslauthd
mv /etc/default/saslauthd.tmp /etc/default/saslauthd
service saslauthd start
echo cyrus|saslpasswd2 -c cyrus

cyradm --user cyrus --pass cyrus 0 >/dev/null <<EOF
cm test.test
sam test.test anyone lrsp
quit
EOF

# mount articles to tmpfs
mkdir /tmp/t
cp --preserve=all /var/spool/cyrus/mail/t/test/test/* /tmp/t
mount -t tmpfs -o size=1000m tmpfs /var/spool/cyrus/mail/t/test/test
cp --preserve=all /tmp/t/* /var/spool/cyrus/mail/t/test/test
rm -rf /tmp/t

## mount articles directory as nullfs
#apt-get install -y fuse libfuse-dev
#git clone https://github.com/xrgtn/nullfs.git
#cd nullfs
#make
#./nul1fs /var/spool/cyrus/mail/t/test/test -o nonempty
#cd ..

service cyrus-imapd restart

# GoPostStuff
mkdir "$BASEDIR/go"
export GOPATH="$BASEDIR/go"
# use this fork for the updated reference that doesn't break
go get github.com/engine9tm/GoPostStuff
go install github.com/engine9tm/GoPostStuff
cat <<EOF >gps-nossl.conf
[global]
From=Test <teSPAMst@examNOSPAMple.com>
DefaultGroup=test
;SubjectPrefix=[OINK]
ArticleSize=768000
ChunkSize=65536
[server "pants"]
Address=localhost
Username=test
Password=test
Connections=4
InsecureSSL=on
EOF
cp gps-nossl.conf gps-ssl.conf
echo "TLS=on" >>gps-ssl.conf
echo "Port=563" >>gps-ssl.conf
echo "TLS=off" >>gps-nossl.conf
echo "Port=119" >>gps-nossl.conf


# NewsUP
#echo -e "Y\nY"|cpan -iT Config::Tiny IO::Socket::SSL Inline::C # it's slooowww...
cpanm -in Config::Tiny IO::Socket::SSL Inline::C
git clone https://github.com/demanuel/NewsUP.git
# compile Inline C
cd NewsUP
perl newsup.pl
cd ..

# Nyuu
git clone https://github.com/animetosho/Nyuu.git
cd Nyuu
#npm install -g node-gyp
npm install --no-optional --unsafe-perm  # flag seems to be necessary on Scaleway
cd ..

# Newsmangler
git clone https://github.com/madcowfred/newsmangler.git
cat <<EOF >newsmangler-nossl.conf
[posting]
from: Newsmangler <Newsmangler@gmail.com>
default_group: test
article_size: 768000
subject_prefix:
generate_nzbs: 0
skip_filenames:
[aliases]
test: test
[server]
hostname: localhost
username: test
password: test
connections: 4
reconnect_delay: 5
EOF
cp newsmangler-nossl.conf newsmangler-ssl.conf
echo "ssl: 1" >>newsmangler-ssl.conf
echo "port: 563" >>newsmangler-ssl.conf
echo "ssl: 0" >>newsmangler-nossl.conf
echo "port: 119" >>newsmangler-nossl.conf

# Newsmangler (fork)
mkdir tmp
cd tmp
git clone https://github.com/nicors57/newsmangler.git
mv newsmangler ../newsmangler2
cd ..
rmdir tmp

# Sanguinews
gem install sanguinews
cat <<EOF >sanguinews-nossl.conf
groups = test
from = witty_nickname <whatever@example.com>
username = test
password = test
server = localhost
connections = 4
article_size = 768000
reconnect_delay = 5
prefix = "[sanguinews] - "
nzb = no
header_check = no
debug = no
xna = no
EOF
cp sanguinews-nossl.conf sanguinews-ssl.conf
echo "ssl = yes" >>sanguinews-ssl.conf
echo "port = 563" >>sanguinews-ssl.conf
echo "ssl = no" >>sanguinews-nossl.conf
echo "port = 119" >>sanguinews-nossl.conf

# Newspost threaded fork
git clone https://github.com/PietjeBell88/newspost.git
mv newspost newspost-thread
cd newspost-thread
# remove the forced 3 second wait time
sed "s/ + post_delay;/;/" ui/ui.c >ui/ui2.c
unlink ui/ui.c
mv ui/ui2.c ui/ui.c
# for some reason, I need to add these or compilation fails
sed -i "s/^\(OPT_FLAGS\|OPT_LIBS\) = /\0-pthread /" Makefile
make -j2
cd ..

# Newspost
git clone https://github.com/joehillen/newspost.git
cd newspost
# remove the forced 3 second wait time
sed "s/ + post_delay;/;/" ui/ui.c >ui/ui2.c
unlink ui/ui.c
mv ui/ui2.c ui/ui.c
make -j2
make install
cd ..

# Upload file
mkdir ulfile
dd if=/dev/zero bs=1M count=256 | openssl rc4 -e -k not_secret | head -c268435456 >ulfile/data
