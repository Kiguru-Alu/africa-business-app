README — World Economy Explorer

Static HTML/CSS/JS app that lets you explore World economic indicators (World Bank V2) and inspect country profiles with 10-year trends.

This README has two parts:

Part 1 — App description & functionality

Part 2 — Deployment & server/load-balancer configuration (step-by-step)

Part 1 — App description & functionality

Name: World Economy Explorer
Files: index.html, styles.css, script.js (located in /var/www/html/africa-business-app/)
Type: Static client-side web app (no backend required)
Data source: World Bank Open Data API (V2) — no API key required

What the app does

Lets the user select an economic indicator (GDP, GDP per capita, GDP growth, population, inflation, unemployment, etc.) and view the latest available non-null value for every African country (selected by region filter).

Provides search, sort, and filter abilities on the table of countries.

Clicking a country opens a country profile modal showing:

A 10-year trend chart for the currently selected indicator (Chart.js used from CDN).

A list of latest key indicators (GDP, growth %, population, inflation, etc.).

Handles API quirks:

Uses World Bank V2 endpoints.

Fetches a limited date range (last 10–12 years) and picks the most recent non-null value.

Uses bulk indicator fetch for performance (/country/all/indicator/…&per_page=1000) and then maps to countries instead of doing one call per country.

No sensitive credentials are embedded in the repo. (World Bank V2 is keyless.)

Why it’s useful

Quick comparative view of African economies.

Country profiles with trends to spot recent movement.

Lightweight and deployable as static files on any web server (Nginx used here).

Part 2 — Deployment & load-balancer configuration (detailed)

This section documents the exact steps performed on Web01 (44.201.90.229), Web02 (44.206.243.220), and LB01 (44.202.4.117). Use it as your hands-on deployment guide and verification checklist.

Summary of architecture
Client (browser)
   ⇩ HTTPS
LB01 (HAProxy) — TLS termination; round-robin → Web01, Web02
   ⇩ HTTP
Web01 (Nginx) — serves /var/www/html/africa-business-app
Web02 (Nginx) — serves /var/www/html/africa-business-app


DNS entries:

A record mahui.tech → 44.202.4.117 (LB01)

A record www.mahui.tech → 44.202.4.117

Why HAProxy + TLS termination?

Centralized certificate management (Let’s Encrypt on LB01).

Offload TLS from web servers (simpler web server config).

Round-robin load balancing for simple scalability and redundancy.

Health checks ensure traffic only goes to healthy web backends.

Preparation & assumptions

You have SSH access to the three servers (user ubuntu used in examples).

You have a functional private key for SSH (stored locally). Keep permissions chmod 600 key.

Static app files already exist on both web servers at:

/var/www/html/africa-business-app/
  ├─ index.html
  ├─ styles.css
  └─ script.js


Nginx installed on Web01 and Web02. HAProxy installed on LB01.

Domain owner can add A records pointing to LB01.

Step A — Copy app files to both web servers (if needed)

If not already present, copy the folder using scp (example uses key.pem — replace with your key path and myapp):

# copy to web01
scp -i key.pem -r myapp/ ubuntu@44.201.90.229:/tmp/
ssh -i key.pem ubuntu@44.201.90.229 "sudo rm -rf /var/www/html/* && sudo cp -r /tmp/myapp/* /var/www/html/ && sudo chown -R www-data:www-data /var/www/html/"

# copy to web02
scp -i key.pem -r myapp/ ubuntu@44.206.243.220:/tmp/
ssh -i key.pem ubuntu@44.206.243.220 "sudo rm -rf /var/www/html/* && sudo cp -r /tmp/myapp/* /var/www/html/ && sudo chown -R www-data:www-data /var/www/html/"

Step B — Configure Nginx on Web01 and Web02

Goal: make Nginx serve /var/www/html/africa-business-app as the default site.

Create an Nginx site file (on each web server). Example file path: /etc/nginx/sites-available/africa_business_app.conf

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root /var/www/html/africa-business-app;
    index index.html index.htm;

    location / {
        try_files $uri $uri/ /index.html =404;
    }

    # helpful header to verify which server served the request
    add_header X-Served-By "web01" always;  # set "web02" on the other server
}


Enable the site and remove the default site to avoid catch-all redirects:

sudo ln -sf /etc/nginx/sites-available/africa_business_app.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo rm -f /etc/nginx/sites-available/default


Fix ownership & permissions:

sudo chown -R www-data:www-data /var/www/html/africa-business-app
sudo find /var/www/html/africa-business-app -type d -exec chmod 755 {} \;
sudo find /var/www/html/africa-business-app -type f -exec chmod 644 {} \;


Test & reload:

sudo nginx -t
sudo systemctl reload nginx


Verify locally (on the web server):

curl -I http://localhost:80      # should return HTTP/1.1 200 OK and X-Served-By header
curl http://localhost:80/ | head -n 20  # should return HTML from index.html


Verify remotely (from your workstation):

curl -I http://44.201.90.229:80 | grep -i X-Served-By
curl -I http://44.206.243.220:80 | grep -i X-Served-By


Notes & gotchas

Ensure there are no other server blocks with default_server or global redirect rules (e.g., files in /etc/nginx/conf.d) — these override your site block.

If you saw conflicting server name "_" warnings earlier, remove duplicate enabled site files and keep a single default server block per machine.

Step C — Configure HAProxy on LB01 (LB performs SSL termination and load balances)

Example HAProxy config (/etc/haproxy/haproxy.cfg):

global
    log /dev/log local0
    maxconn 4096
    tune.ssl.default-dh-param 2048

defaults
    log     global
    mode    http
    option  httplog
    option  dontlognull
    timeout connect 5s
    timeout client  30s
    timeout server  30s

# Redirect HTTP to HTTPS
frontend http_in
    bind *:80
    mode http
    redirect scheme https code 301 if !{ ssl_fc }

# HTTPS frontend (TLS terminated here)
frontend https_in
    bind *:443 ssl crt /etc/haproxy/certs/mahui.tech.pem
    mode http
    option forwardfor
    default_backend web_servers

backend web_servers
    mode http
    balance roundrobin
    option httpchk GET / HTTP/1.1\r\nHost:\ mahui.tech
    server web01 44.201.90.229:80 check
    server web02 44.206.243.220:80 check


Important notes:

crt /etc/haproxy/certs/mahui.tech.pem must be a single PEM file that contains the certificate chain then the private key concatenated.

Health check option httpchk ensures inactive/unhealthy web servers are not used.

Step D — Obtain Let’s Encrypt certs on LB01 (Certbot) & prepare HAProxy PEM

Ensure DNS for mahui.tech and www.mahui.tech points to LB01 IP (44.202.4.117). Validate locally:

dig +short mahui.tech
dig +short www.mahui.tech


Both should resolve to 44.202.4.117.

Stop HAProxy (so certbot standalone can bind to port 80):

sudo systemctl stop haproxy


Install certbot (snap recommended) and request certificates:

# install certbot (snap)
sudo apt update
sudo apt install -y snapd
sudo snap install core; sudo snap refresh core
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot

# request certificate; replace email with yours
sudo certbot certonly --standalone -d mahui.tech -d www.mahui.tech --agree-tos --non-interactive -m youremail@example.com


Create combined PEM for HAProxy:

sudo mkdir -p /etc/haproxy/certs
sudo bash -c 'cat /etc/letsencrypt/live/mahui.tech/fullchain.pem /etc/letsencrypt/live/mahui.tech/privkey.pem > /etc/haproxy/certs/mahui.tech.pem'
sudo chmod 600 /etc/haproxy/certs/mahui.tech.pem


Start HAProxy:

sudo systemctl start haproxy
sudo systemctl enable haproxy


Configure automatic renewal hook so HAProxy reloads after certificate renewal:

Create /etc/letsencrypt/renewal-hooks/deploy/haproxy-reload.sh:

#!/bin/bash
DOMAIN="mahui.tech"
cat /etc/letsencrypt/live/$DOMAIN/fullchain.pem /etc/letsencrypt/live/$DOMAIN/privkey.pem > /etc/haproxy/certs/$DOMAIN.pem
chmod 600 /etc/haproxy/certs/$DOMAIN.pem
systemctl reload haproxy


Make it executable:

sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/haproxy-reload.sh


Test renewal dry run:

sudo certbot renew --dry-run

Step E — Final verification & testing (very important)

Test Nginx backend health from LB01:

ssh -i key.pem ubuntu@44.202.4.117
curl -I http://44.201.90.229:80
curl -I http://44.206.243.220:80


Both should return 200 OK and show the X-Served-By header.

Test LB HTTP → HTTPS redirect:

curl -I http://mahui.tech
# expect 301 redirect to https


Test HTTPS served by LB (repeat to see round-robin):

for i in {1..6}; do curl -sI https://mahui.tech | grep -i X-Served-By; sleep 1; done


You should see X-Served-By: web01 and X-Served-By: web02 alternating. If only one server shows, check HAProxy backend health or nginx availability on the other server.

Inspect certificate:

openssl s_client -connect mahui.tech:443 -servername mahui.tech </dev/null 2>/dev/null | openssl x509 -noout -dates


Test app functionality through the LB (client experience test):

Open https://mahui.tech in browser — use dev tools to confirm index.html loads and requests to World Bank API succeed in the console.

Click several countries and indicators; confirm charts render and no CORS/HTTP errors.