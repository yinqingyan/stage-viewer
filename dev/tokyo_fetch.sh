#!/bin/sh
# 通过东京服务器抓国内网站（用户在美国，国内站点从这里连不上）：dev/tokyo_fetch.sh URL 输出文件
ssh -i ~/.ssh/relay_ed25519 -o IdentitiesOnly=yes -o ConnectTimeout=15 ubuntu@43.167.197.135 "curl -sL --max-time 40 -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' '$1'" > "$2"
