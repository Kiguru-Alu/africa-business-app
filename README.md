# Africa Business App — World Economy Explorer


(  Link to Demo Video : https://www.youtube.com/watch?v=4eq0RBKpBHA )

> Static frontend (HTML/CSS/JS) dashboard for exploring World Bank V2 economic indicators with country profiles and 10-year charts.  
> Designed to run locally for development and to be deployed to two Nginx web servers behind an HAProxy load balancer with HTTPS termination.

---

## Contents

- **Part 1 — App overview & local run**
- **Part 2 — Production deployment (Web01, Web02, LB01)**  
  - Architecture overview  
  - DNS & domain notes  
  - Nginx configuration (web servers)  
  - HAProxy configuration (load balancer)  
  - Obtaining & installing Let’s Encrypt certs (certbot)  
  - Health checks, automation scripts, and verification tests  
  - Troubleshooting and common fixes
- **Credits & external resources**

---

## Part 1 — App overview & local run

### What the app is
**Africa Business App (World Economy Explorer)** is a client-side static application (no server-side code required) built with:

- `index.html` — UI and layout  
- `styles.css` — styling and responsive rules  
- `script.js` — JavaScript that fetches data from the **World Bank Open Data API (V2)**, renders tables, supports search/sort/filter and draws 10-year charts using Chart.js (loaded from CDN).

### Core features
- Select an indicator (GDP, GDP per capita, GDP growth, population, inflation, etc.)
- Table of countries with the latest available (non-null) value per country
- Search, filter and sort the table
- Country profile modal showing a 10-year trend chart and key indicators
- Graceful error handling if the API is slow or returns empty values

### Local development / testing
You can run the app entirely from the file system or from a minimal local HTTP server.

**Open directly in browser**  
Open `/path/to/africa-business-app/index.html` in your browser. (Works for most features, but some browsers block `fetch()` from `file://`.)

**Recommended: start a simple local HTTP server (Python)**
```bash
# from inside the app folder
python3 -m http.server 8000
# then open http://localhost:8000 in your browser


Notes for development

The app calls the World Bank V2 endpoints directly from the browser. No API key is required.

If you change styles.css, press Ctrl+F5 (or Cmd+Shift+R) to hard-refresh the browser to avoid caching.

Part 2 — Production deployment (complete)
Architecture (what we deployed)
Client (browser)
   ⇩ HTTPS
LB01 (HAProxy) — TLS termination; round-robin → Web01, Web02
   ⇩ HTTP
Web01 (Nginx) — serves /var/www/html/africa-business-app (X-Served-By: web01)
Web02 (Nginx) — serves /var/www/html/africa-business-app (X-Served-By: web02)


Server IPs used in deployment

Web01: 44.201.90.229

Web02: 44.206.243.220

LB01: 44.202.4.117

Domain used

mahui.tech (and www.mahui.tech) — both should point (A records) to 44.202.4.117 (LB01).

Why this design

HAProxy on LB01 terminates TLS with Let’s Encrypt certs, so backends can run plain HTTP.

Central TLS simplifies cert management/renewal and offloads CPU work from web servers.

Round-robin load balancing distributes traffic and gives redundancy.

X-Served-By header on each web server verifies which server handled a request.

Files & key locations (final system)

App files (on each web server):

/var/www/html/africa-business-app/
  ├─ index.html
  ├─ styles.css
  └─ script.js


Nginx site (on web servers):

/etc/nginx/sites-available/africa_business_app.conf
/etc/nginx/sites-enabled/ -> symlink to the file above


HAProxy config (on LB):

/etc/haproxy/haproxy.cfg
/etc/haproxy/certs/mahui.tech.pem   # combined fullchain+privkey


Certbot certs (on LB):

/etc/letsencrypt/live/mahui.tech/fullchain.pem
/etc/letsencrypt/live/mahui.tech/privkey.pem


Renewal hook (on LB):

/etc/letsencrypt/renewal-hooks/deploy/haproxy-reload.sh

Nginx configuration (use on Web01 and Web02)

Create /etc/nginx/sites-available/africa_business_app.conf with this content:

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root /var/www/html/africa-business-app;
    index index.html index.htm;

    location / {
        try_files $uri $uri/ /index.html =404;
    }

    # change the header value to "web01" on Web01 and "web02" on Web02
    add_header X-Served-By "web01" always;
}


Enable and reload:

sudo ln -sf /etc/nginx/sites-available/africa_business_app.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo chown -R www-data:www-data /var/www/html/africa-business-app
sudo find /var/www/html/africa-business-app -type d -exec chmod 755 {} \;
sudo find /var/www/html/africa-business-app -type f -exec chmod 644 {} \;
sudo nginx -t && sudo systemctl reload nginx


Verification (on each web server)

curl -I http://localhost:80      # should return 200 OK and X-Served-By
curl -I http://<WEB_IP>:80 | grep -i X-Served-By

HAProxy config (LB01) — TLS termination + round robin

Edit /etc/haproxy/haproxy.cfg (replace mahui.tech where needed):

global
    log /dev/log local0
    maxconn 4096
    tune.ssl.default-dh-param 2048
    stats socket /run/haproxy/admin.sock mode 660 level admin

defaults
    log     global
    mode    http
    option  httplog
    option  dontlognull
    timeout connect 5s
    timeout client  30s
    timeout server  30s
    timeout http-request 10s

frontend http_in
    bind *:80
    mode http
    redirect scheme https code 301 if !{ ssl_fc }

frontend https_in
    bind *:443 ssl crt /etc/haproxy/certs/mahui.tech.pem no-sslv3
    mode http
    option forwardfor
    default_backend web_servers

backend web_servers
    mode http
    balance roundrobin
    option httpchk GET /health.html HTTP/1.1\r\nHost:\ mahui.tech
    server web01 44.201.90.229:80 check
    server web02 44.206.243.220:80 check

# Optional: lightweight stats UI (enable if needed)
listen stats
    bind *:8404
    mode http
    stats enable
    stats uri /haproxy_stats
    stats refresh 30s
    # stats auth admin:StrongPassword


Important notes

mahui.tech.pem must contain fullchain.pem then privkey.pem concatenated.

option httpchk uses /health.html. Create that file on both web servers:

<!-- /var/www/html/africa-business-app/health.html -->
OK


Validate and restart HAProxy

sudo haproxy -f /etc/haproxy/haproxy.cfg -c
sudo systemctl restart haproxy
sudo systemctl status haproxy

Obtaining Let’s Encrypt certs on LB01 (certbot stand-alone)

Ensure DNS A records point to LB01:

mahui.tech → 44.202.4.117

www.mahui.tech → 44.202.4.117

Stop HAProxy (certbot needs ports 80/443 free for standalone):

sudo systemctl stop haproxy


Install certbot (snap) and request certs:

sudo apt update
sudo apt install -y snapd
sudo snap install core; sudo snap refresh core
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot

sudo certbot certonly --standalone \
  -d mahui.tech -d www.mahui.tech \
  --agree-tos --non-interactive -m youremail@example.com


Build combined PEM for HAProxy:

sudo mkdir -p /etc/haproxy/certs
sudo bash -c 'cat /etc/letsencrypt/live/mahui.tech/fullchain.pem /etc/letsencrypt/live/mahui.tech/privkey.pem > /etc/haproxy/certs/mahui.tech.pem'
sudo chmod 600 /etc/haproxy/certs/mahui.tech.pem


Restart HAProxy:

sudo systemctl start haproxy


Add renewal hook (so HAProxy reloads when certs renew). Create /etc/letsencrypt/renewal-hooks/deploy/haproxy-reload.sh:

#!/bin/bash
DOMAIN="mahui.tech"
cat /etc/letsencrypt/live/$DOMAIN/fullchain.pem /etc/letsencrypt/live/$DOMAIN/privkey.pem > /etc/haproxy/certs/$DOMAIN.pem
chmod 600 /etc/haproxy/certs/$DOMAIN.pem
systemctl reload haproxy


Make it executable:

sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/haproxy-reload.sh


Test renewal dry-run:

sudo certbot renew --dry-run

Deployment automation (example scripts)

configure-africa-app.sh — run on each web server (idempotent):

#!/usr/bin/env bash
set -euo pipefail
APP_DIR="/var/www/html/africa-business-app"
SITE_AVAIL="/etc/nginx/sites-available/africa_business_app.conf"
SITE_ENABLED="/etc/nginx/sites-enabled/africa_business_app.conf"
HOST_MARKER="$(hostname)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo"
  exit 1
fi
if [ ! -d "$APP_DIR" ]; then
  echo "ERROR: $APP_DIR missing"
  exit 2
fi

cat > "$SITE_AVAIL" <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root $APP_DIR;
    index index.html index.htm;

    location / {
        try_files \$uri \$uri/ /index.html =404;
    }

    add_header X-Served-By "$HOST_MARKER" always;
}
EOF

ln -sf "$SITE_AVAIL" "$SITE_ENABLED"
rm -f /etc/nginx/sites-enabled/default || true
chown -R www-data:www-data "$APP_DIR"
find "$APP_DIR" -type d -exec chmod 755 {} \;
find "$APP_DIR" -type f -exec chmod 644 {} \;
nginx -t
systemctl reload nginx
echo "Done on $(hostname)."


deploy-to-servers.sh — from your workstation to run the above on both servers (adjust SSH key path):

#!/usr/bin/env bash
set -euo pipefail
SSH_KEY="africa-business-app/school"
WEB1="ubuntu@44.201.90.229"
WEB2="ubuntu@44.206.243.220"
SCRIPT="configure-africa-app.sh"

for HOST in "$WEB1" "$WEB2"; do
  scp -i "$SSH_KEY" "$SCRIPT" "$HOST:~"
  ssh -i "$SSH_KEY" "$HOST" "sudo bash ~/$SCRIPT"
done

Verification & testing (end-to-end)

Check each backend (from LB01 or your laptop):

curl -I http://44.201.90.229:80 | grep -i X-Served-By
curl -I http://44.206.243.220:80 | grep -i X-Served-By


Test LB HTTP → HTTPS redirect

curl -I http://mahui.tech
# expect 301 Location: https://mahui.tech/


Test HTTPS via LB and round-robin

for i in {1..6}; do curl -sI https://mahui.tech | grep -i X-Served-By; sleep 1; done


You should see web01 and web02 alternate.

Check certificate

openssl s_client -connect mahui.tech:443 -servername mahui.tech </dev/null 2>/dev/null | openssl x509 -noout -dates


Simulate failures

Stop Nginx on Web02 and observe LB only returns web01. Restart Web02 and verify balancing resumes.

Common issues & troubleshooting

Certbot NXDOMAIN error: Ensure DNS A records for mahui.tech and www.mahui.tech point to LB01 before running certbot.

HAProxy fails to start due to PEM: Verify /etc/haproxy/certs/mahui.tech.pem exists and contains both the fullchain and private key concatenated.

301 or redirect issues on web servers: Remove duplicate default_server blocks or any server blocks in /etc/nginx/conf.d/ that force redirects.

Nginx permission errors on nginx -t: Use sudo nginx -t; if errors persist, check ownership of /var/log/nginx and /run/nginx.pid.

CSS/asset changes not visible: Clear browser cache (Ctrl+F5), or test each backend directly with curl to ensure both servers have the updated file.

Demo checklist (≤ 2 min)

Record a short demo showing:

Local app usage (search, open country profile).

curl -I http://44.201.90.229:80 → X-Served-By: web01.

curl -I http://44.206.243.220:80 → X-Served-By: web02.

curl -I http://mahui.tech → shows 301 redirect to https.

Repeat curl -sI https://mahui.tech multiple times and show X-Served-By alternates.

Show cert details via openssl s_client or browser padlock.

Credits & external resources

World Bank Open Data API (V2) — primary data source. Documentation: https://datahelpdesk.worldbank.org/knowledgebase/articles/889386-developer-information-overview

Thanks to the World Bank for making global development data available.

Chart.js — charting library used for trend graphs (CDN). https://www.chartjs.org/

Nginx — web server used on Web01 and Web02. https://nginx.org/

HAProxy — load balancer used on LB01. https://www.haproxy.org/

Let’s Encrypt / Certbot — free TLS certificates and automation. https://letsencrypt.org/
 and https://certbot.eff.org/

Helpful references & troubleshooting

HAProxy docs and config examples: https://www.haproxy.org/#docs

World Bank API v2 indicators: https://data.worldbank.org/indicator

Security & operational notes

Never commit private SSH keys, certificates, or any secrets to the repository. Use .gitignore.

Keep certbot renewals tested: sudo certbot renew --dry-run.

Rotate SSH keys if a key is suspected compromised. Keep permissions chmod 600 on private keys.

Consider a small monitor (uptime ping) and log forwarding for production setups.

License

(Choose a license for your repo — e.g., MIT)

MIT License