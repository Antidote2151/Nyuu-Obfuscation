#!/bin/sh
# Local upload benchmark against bench/dummy-nntp.js (start that first), using the option set of the
# production app. Env: NODE (node binary), FILE (input file), ACCOUNTS (servers), CONN (connections per
# server), PORT, EXTRA (additional nyuu args, e.g. "--connection-threads 4"), PROF=1 for --cpu-prof.
# Example: FILE=/tmp/rand4g ACCOUNTS=4 sh bench/local-bench.sh
cd "$(dirname "$0")/.."
NODE=${NODE:-node}; PORT=${PORT:-5563}; ACCOUNTS=${ACCOUNTS:-1}; CONN=${CONN:-50}
OUT=${OUT:-${TMPDIR:-/tmp}/nyuu-bench.nzb}
[ -f "$FILE" ] || { echo "FILE not set / missing"; exit 1; }

SERVERS=""
i=1
while [ $i -lt "$ACCOUNTS" ]; do
	SERVERS="$SERVERS --server nntps://u$i:p$i@127.0.0.1:$PORT?connections=$CONN"
	i=$((i+1))
done
[ -n "$PROF" ] && PROFARGS="--cpu-prof --cpu-prof-dir=${PROFDIR:-bench-prof}"

# shellcheck disable=SC2086
"$NODE" $PROFARGS -r ./bench/stats-preload.js bin/nyuu.js \
	-h 127.0.0.1 -P "$PORT" -S --ignore-cert -u user -p pass -n "$CONN" $SERVERS \
	-a 700K --progress log:1000ms --groups alt.binaries.test -o "$OUT" -O \
	--subject "{filename}" --nzb-subject "{filename}" --nzb-poster "poster <p@p>" \
	--obfuscate-articles --connect-retries 5 --post-retries 10 --post-retry-delay 1 --retry-on-bad-resp \
	--nzb-del-incomplete --nzb-file-mode defer -r keep --post-chunk-size 0 \
	$EXTRA "$FILE" 2>&1 | grep -E "Finished uploading|Upload Rate|\[stats\]|rror" | tail -n 25
