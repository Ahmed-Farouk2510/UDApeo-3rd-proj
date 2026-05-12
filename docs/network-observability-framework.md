# Network Observability Framework

**Cloudflare (DNS + TLS termination) · FortiGate HA with full UTM · OCI Origins · End‑to‑End Latency**

Metrics · Sources · Alerts · Thresholds · Tools · Dashboards · How / Requirements / Advantages

Version 2.0 · Network Operations

---

## Scope

- **Cloudflare** is used as **authoritative DNS** and **TLS termination / reverse‑proxy edge**. Observability focuses on traffic volume, HTTP error codes, origin response time, TLS health, and DNS query metrics.
- **FortiGate HA** is the central traffic hub for north‑south and east‑west traffic and the primary security inspection point. It runs the full UTM stack: **IPS, AntiVirus, Application Control, Web Filter, DNS Filter, SSL/SSH Inspection**, in addition to stateful firewalling, IPsec/SSL VPN, and BGP routing. Logs are exported via **syslog → Promtail → Loki**.
- **OCI** hosts the origins (VCN, Load Balancers, Compute, Block Volume, DRG/FastConnect) and provides VCN Flow Logs, OCI Monitoring, and OCI Audit.
- **Observability stack** — Prometheus + SNMP Exporter + Blackbox Exporter, Loki (via Promtail), Grafana (dashboards + alerting) → Slack / PagerDuty / Email.

## Traffic Flow Architecture

```
Client
  │
  ▼
Cloudflare Edge   ── Authoritative DNS · TLS termination / reverse proxy · Edge analytics & logs
  │
  ▼
FortiGate HA      ── Stateful FW · IPsec/SSL VPN · BGP · UTM (IPS, AV, App-Ctrl, Web/DNS Filter, SSL Inspection)
  │
  ▼
OCI VCN           ── Subnets · Security Lists / NSGs · Flow Logs
  │
  ▼
OCI LB → Origin VMs / Block Volume / DRG (on-prem)
```

Each layer is monitored independently and correlated end‑to‑end for latency and errors.

---

# PART 1 — Cloudflare (DNS + TLS Termination)

## 1.0 What Cloudflare provides for monitoring

| Capability | Where it lives in the dashboard | Visibility produced |
|---|---|---|
| Authoritative DNS | DNS → Records, DNS → Analytics | Query rate, query type mix, response codes, top names, NXDOMAIN ratio |
| TLS / SSL termination | SSL/TLS → Edge Certificates | Certificate validity, TLS protocol version mix, handshake errors |
| HTTP edge analytics (proxy) | Analytics → Traffic | Total requests, status code distribution (2xx/3xx/4xx/5xx), bandwidth, cached vs uncached |
| Cache analytics (if caching is enabled) | Caching → Analytics | Cache hit ratio, bytes served from cache |
| Origin response performance | Analytics + Logpush | Origin status codes, `OriginResponseDurationMs` |
| Logpush (HTTP logs) | Analytics → Logs → Logpush | Streamed per‑request log records to Loki / S3 / HTTP endpoint |
| DNS Logs (Logpush) | Analytics → Logs → Logpush | Per‑query authoritative DNS records |

## 1.1 Key Metrics to Monitor

| Metric | Category | Threshold / Alert | Severity | Impact | Source |
|---|---|---|---|---|---|
| HTTP Request Rate | Traffic | Spike > 3× baseline / 5 min | Medium | Capacity / load signal | CF Analytics API / Logpush |
| HTTP 4xx Rate | Traffic | > 5% sustained / 5 min | Medium | Client / config issue | CF Analytics / Logpush |
| HTTP 5xx Rate | Traffic | > 1% sustained / 5 min | High | Origin failure | CF Analytics / Logpush |
| HTTP 502 / 504 from CF edge | Traffic | Any sustained > 0.5% | High | Origin reachability problem from CF | Logpush `EdgeResponseStatus` |
| Bandwidth Consumed | Traffic / Cost | Spike > 200% | Medium | Demand / cost signal | CF Analytics |
| Cache Hit Ratio (if caching used) | Performance | < 70% sustained | Medium | Origin overload risk | CF Cache Analytics |
| Origin Response Time (P95) | Performance | > 2000 ms | High | Degraded user experience | CF Logpush `OriginResponseDurationMs` |
| Time to First Byte (edge) | Performance | P95 > 1500 ms | High | Slow page loads | CF Analytics / Logpush |
| DNS Query Rate | DNS | Spike > 3× baseline | Medium | Capacity / abuse signal | CF DNS Analytics |
| DNS NXDOMAIN ratio | DNS | > 5% of total | Medium | Misconfig or DNS scanning | CF DNS Analytics |
| DNS Response Time | DNS | P95 > 100 ms | Medium | Slow client connects | CF DNS Analytics |
| TLS Handshake Error Rate | TLS | > 1% | Medium | Client connectivity issues | CF Analytics |
| TLS Protocol Version Mix | TLS | Drop in TLS 1.3 share | Low | Client compatibility | CF Analytics |
| Certificate Expiry | TLS | < 14 days | High | Outage risk | CF Edge Certificates / API |

## 1.2 How to get Cloudflare data into Grafana

### Option A — Cloudflare official Grafana plugin (quick start)

- **How** — install `grafana-cloudflare-datasource` from the Grafana plugin catalogue. Configure with a Cloudflare API token scoped `Zone → Analytics → Read` and `Account → Analytics → Read`.
- **Requirements** — a Cloudflare account and a read‑only API token.
- **Advantages** — zero pipeline to maintain; provides request volume, bandwidth, status‑code mix, cache hit ratio, top countries, DNS analytics. Works on every Cloudflare plan.
- **Limitation** — aggregated metrics only (1‑minute minimum granularity); does not expose per‑request fields, so origin‑latency percentiles must come from Logpush.

### Option B — Logpush → Loki (recommended for per‑request HTTP analytics)

- **How**
  1. Cloudflare Dashboard → Analytics → Logs → **Logpush** → Add destination.
  2. Destination = HTTP endpoint pointing at a Loki gateway (or S3 → Promtail → Loki).
  3. Enable the **`http_requests`** dataset (and optionally `dns_logs` for per‑query DNS visibility).
  4. In Grafana add a Loki data‑source and build dashboards with LogQL.
- **Recommended fields (`http_requests`)** — `ClientIP`, `ClientCountry`, `ClientRequestHost`, `ClientRequestURI`, `ClientRequestMethod`, `ClientSSLProtocol`, `EdgeResponseStatus`, `OriginResponseStatus`, `OriginResponseDurationMs`, `EdgeStartTimestamp`, `EdgeEndTimestamp`, `CacheCacheStatus`, `RayID`.
- **Requirements** — a Cloudflare plan tier that includes Logpush (Pro / Business / Enterprise), and Loki + Promtail (or Vector) running in OCI.
- **Advantages**
  - Per‑request visibility — derive **true P50 / P95 / P99 origin latency** from real production traffic.
  - Slice HTTP error codes by host, URI, country, and request method.
  - Long‑term retention is your choice (cheap object storage).

### Option C — Prometheus scraping the Analytics API (fallback, all plans)

- **How** — run `cloudflare_exporter` on an OCI VM and scrape `/zones/{id}/analytics/dashboard` and `/zones/{id}/dns_analytics/report` every 60 s into Prometheus.
- **Requirements** — Cloudflare API token (read‑only Analytics).
- **Advantages** — works on every Cloudflare plan; cheap; no log ingestion costs; sufficient for traffic + HTTP error‑code dashboards.
- **Limitation** — aggregated only; no per‑request fields.

## 1.3 Recommended Cloudflare Grafana Dashboards

| Panel | Source | Query (example) | Notes |
|---|---|---|---|
| Request rate (total / by host) | Logpush → Loki | `sum(rate({source="cloudflare", dataset="http_requests"} [5m]))` | Top‑line health view |
| Status code distribution | Logpush → Loki | `sum by (status) (count_over_time({dataset="http_requests"} | json | __error__="" [5m]))` | 2xx / 3xx / 4xx / 5xx stacked |
| 5xx error rate by host | Logpush → Loki | `sum by (host) (rate({dataset="http_requests"} | json | EdgeResponseStatus=~"5.." [5m]))` | Pinpoint failing app |
| Top 4xx URIs | Logpush → Loki | `topk(20, sum by (uri) (count_over_time({} | json | status=~"4.." [15m])))` | Surface bad clients / broken paths |
| Origin latency P50 / P95 / P99 | Logpush → Loki | `histogram_quantile(0.95, sum(rate({…} | unwrap OriginResponseDurationMs [5m])) by (le))` | Real‑traffic latency |
| Bandwidth (in / out) | CF plugin | Analytics API | Cost & demand tracking |
| Cache hit ratio (if used) | CF plugin | `cacheStatus` breakdown | Origin offload effectiveness |
| DNS query rate / response codes | CF plugin (DNS Analytics) | `queriesPerSecond`, `responseCodeName` | Authoritative DNS health |
| TLS handshake errors | CF plugin | TLS error count by version | Cert / cipher misconfig |
| Certificate expiry watch | CF API exporter | days‑to‑expiry per cert | Page at 14 days, ticket at 30 |

## 1.4 Cloudflare Alerting

| Channel | What it covers | How |
|---|---|---|
| **Cloudflare Notifications** | Origin error‑rate notification, certificate expiry, Logpush job failure | Dashboard → Notifications → email / Slack webhook / PagerDuty |
| **Grafana alerting on Loki** | 5xx rate > 2%, origin P95 > 2 s, 502/504 sustained | Grafana alert rules → Slack / PagerDuty |
| **Cloudflare Notifications — DNS** | DNSSEC anomalies, unusual NXDOMAIN spikes (where supported) | Dashboard → Notifications |

---

# PART 2 — FortiGate HA Cluster

The FortiGate HA pair is the central traffic hub and the primary security inspection point. Observability is delivered with **SNMP v3 + syslog**: SNMP feeds Prometheus for numeric metrics; syslog feeds Promtail → Loki for security and event logs. The FortiGate REST API is used for ad‑hoc drilldowns.

## 2.0 How SNMP and syslog work together (and how they appear in Grafana)

SNMP and syslog are **two independent monitoring channels running at the same time on the FortiGate**. Each one feeds a different kind of data into Grafana, and both end up in the same dashboards.

|  | **SNMP v3 (Prometheus)** | **Syslog (Loki via Promtail)** |
|---|---|---|
| Direction | **Pull** — Prometheus SNMP Exporter polls FortiGate every 30 s | **Push** — FortiGate sends a log line every time an event happens, in real time |
| Data shape | Numeric counters (integers, gauges) | Text event records (key=value lines) |
| What it's good for | Anything that is a **number that changes over time** — CPU %, memory %, sessions, throughput per interface, disk %, temperature, BGP peer state (0/1), tunnel state (0/1), SSL‑VPN user count | Anything that is a **described event** — IPS signature fired, virus name caught, URL blocked, DNS C2 hit, admin logged in, config changed, HA failover happened, VPN tunnel went up/down |
| Stored in | Prometheus TSDB | Loki log store |
| Queried in Grafana with | **PromQL** | **LogQL** |
| Typical Grafana panels | Time‑series line charts, gauges, stat panels, bar charts, state‑timeline | Searchable log explorer **+** graphs derived from log counts (`count_over_time`, `topk`, `sum by …`), tables, geo‑maps |

### Side‑by‑side example

- **SNMP** answers: *"CPU on FG‑primary is 67 % and has been climbing for 20 min."* → line‑chart panel.
- **Syslog** answers: *"At 14:02:11 IPS sensor blocked attack `MS.SMB.Server.Request.Handling` from 185.220.x.x (Russia) hitting 10.0.5.12:445; severity=critical."* → searchable log line **AND** a count panel showing 12 critical IPS hits in the last hour.

### What a single FortiGate Grafana dashboard looks like

One dashboard can — and should — mix both data sources. The viewer does not see which row came from where; they just see one coherent picture of the firewall.

| Row | Panel | Data source |
|---|---|---|
| 1 — Health | CPU %, Memory %, Sessions vs licensed max, Disk %, HA sync status, last failover time | **Prometheus / SNMP** |
| 2 — Throughput | bps in/out per N‑S interface, per E‑W interface, error rate, packet drops | **Prometheus / SNMP** |
| 3 — Routing & VPN | BGP peer up matrix, IPsec tunnel up matrix, SSL‑VPN active users; "tunnel went down" event list | **Prometheus / SNMP** + **Loki / syslog** for the event list |
| 4 — IPS | attacks per minute (time‑series), top 20 attack names (bar), severity heatmap, attacker geo‑map, action distribution (blocked / detected / reset) | **Loki / syslog** |
| 5 — AntiVirus | detections per minute, top virus names, top destination URLs, file types, hosts triggering AV | **Loki / syslog** |
| 6 — Web / DNS / App Control | blocks per minute (one panel each), top blocked categories, top blocked URLs / domains / apps, top users hitting blocks | **Loki / syslog** |
| 7 — Admin & Compliance | admin login attempts (success vs failure), config‑change events with admin user + source IP, changes flagged when outside ITSM window | **Loki / syslog** |

> **Short answer to "will I have graphs for syslog?"** — **yes**. Syslog data ends up in Loki, and Grafana turns those log records into graphs using LogQL queries like `count_over_time` and `topk`. The visual experience is identical to SNMP graphs; only the data source behind each panel differs.

## 2.1 Key Metrics to Monitor

| Metric | Domain | Threshold / Alert | Severity | Impact | Source |
|---|---|---|---|---|---|
| CPU Utilization | Platform | > 80% sustained | Critical | Packet drops, latency spike | SNMP `fgSysCpuUsage` |
| Memory Utilization | Platform | > 85% sustained | Critical | Session table pressure | SNMP `fgSysMemUsage` |
| Active Session Count | Platform | > 90% of licensed max | Critical | New connections refused | SNMP `fgSysSesCount` |
| Session Setup Rate | Platform | > 3× baseline | High | DoS / surge signal | SNMP + delta |
| **HA Sync Status** | HA | Out‑of‑sync > 5 min | Critical | Single point of failure | SNMP `fgHaSystemMode` |
| **HA Failover Event** | HA | Any failover | Critical | Service interruption window | Syslog `LOG_ID_HA_*` |
| N/S Interface Throughput | Capacity | > 80% link speed | High | Latency, customer impact | SNMP IF‑MIB |
| E/W Interface Throughput | Capacity | > 80% link speed | High | Inter‑service latency | SNMP IF‑MIB |
| Interface Errors / Drops | Capacity | > 0.5% of packets | High | Silent traffic loss | SNMP + Blackbox ICMP |
| BGP Peer State | Routing | Down | Critical | Routing blackhole | SNMP BGP4‑MIB + syslog |
| BGP Route Count | Routing | Drop > 20% / 5 min | High | Partial routing loss | SNMP + delta |
| IPsec Tunnel Status | VPN | Down | Critical | Site / partner offline | SNMP `fgVpnTunEntStatus` |
| IPsec Tunnel Throughput | VPN | > 80% capacity | Medium | VPN saturation | SNMP |
| SSL‑VPN Active Users | VPN | > 90% of license | Medium | Remote access exhausted | SNMP `fgVpnSslStatsLoginUsers` |
| **IPS Signature Hits** | UTM — IPS | > 500 / min OR any "critical" severity | High / Critical | Active exploit attempt | Syslog `subtype=ips` |
| **AV / Malware Detections** | UTM — AV | Any detection | High | Malware in transit | Syslog `subtype=virus` |
| **App Control blocks** | UTM — AppCtrl | Spike > 3× baseline | Medium | Policy violations / shadow IT | Syslog `subtype=app-ctrl` |
| **Web Filter blocks** | UTM — Web Filter | Spike > 3× baseline | Medium | Phishing / malicious URL | Syslog `subtype=webfilter` |
| **DNS Filter blocks** | UTM — DNS Filter | Any C2 / botnet category hit | Critical | Compromised host beaconing | Syslog `subtype=dns` |
| **SSL Inspection errors** | UTM — SSL | Error rate > 1% | Medium | Broken inspection = blind spot | Syslog `subtype=ssl` |
| Policy Deny Rate | Firewall | Spike > 300% | Medium | Misconfig or attack | Syslog `forward` action=deny |
| Admin Login Failures | Operations | > 5 failures / 10 min | High | Brute‑force attempt | Syslog event `login` |
| Config Change Events | Operations | Any change outside ITSM window | Critical | Unauthorized change | Syslog event `cfg-change` |
| Disk / Log Usage | Operations | > 80% | Medium | Log loss | SNMP `fgSysDiskUsage` |
| Hardware Temperature | Operations | Above vendor threshold | Medium | Hardware failure risk | SNMP sensor MIB |

## 2.2 Data Sources

### A) SNMP v3 — performance, HA, interfaces, VPN, routing

- **How**
```
config system snmp sysinfo
    set status enable
end
config system snmp user
    edit "monitoring"
        set security-level auth-priv
        set auth-proto sha256
        set auth-pwd <pwd>
        set priv-proto aes256
        set priv-pwd <pwd>
        set notify-hosts <prom-vm-ip>
    next
end
```
Restrict SNMP via the FortiGate trust‑host list AND an OCI Security List / NSG that only permits the Prometheus VM. Poll **SNMP Exporter** every 30 s (live metrics) and 5 min (capacity / disk).
- **Requirements** — SNMP v3 user with AuthPriv (SHA‑256 + AES‑256); reachable monitoring subnet; Prometheus + SNMP Exporter; community FortiGate generator file for SNMP Exporter.
- **Advantages** — numeric metrics directly into Prometheus → Grafana; cheap, low CPU on FortiGate; covers every metric in §2.1 except security event detail.

### B) Syslog forwarding — UTM events, security, admin / config

- **How**
```
config log syslogd setting
    set status enable
    set server <syslog-collector-ip>
    set port 514
    set mode reliable          ! TCP
    set facility local6
    set format default
    set source-ip <fgt-mgmt-ip>
end
config log syslogd filter
    set severity information
    set forward-traffic enable
    set local-traffic enable
    set event enable
    set anomaly enable
end
config log eventfilter
    set system enable
    set vpn enable
    set router enable
    set user enable
    set ha enable
end
```
Collector = **Promtail** (or rsyslog → Promtail) → **Loki**. Promtail pipeline extracts FortiGate key/value pairs (`type=`, `subtype=`, `action=`, `srcip=`, `dstip=`, `service=`, `attack=`, `severity=`, `virus=`, `app=`, `cat=`, …).
- **Requirements** — TCP 514 reachable from FortiGate management / HA‑mgmt VIP; Promtail pipeline; Loki retention ≥ 90 days hot.
- **Advantages**
  - One open‑source pipeline covers IPS, AV, App Control, Web Filter, DNS Filter, admin, config‑change, HA, VPN, BGP events.
  - Single search surface in Grafana Explore alongside Cloudflare and OCI logs.
  - No per‑GB licensing cost.

### C) FortiGate REST API — on‑demand drilldowns

- **How** — create a read‑only REST admin profile + API key; call `/api/v2/monitor/system/resource/usage`, `/vpn/ipsec`, `/router/bgp/neighbors`, `/utm/ips-archive`, etc. Use as a Grafana JSON‑API data‑source for ad‑hoc panels.
- **Requirements** — API token bound to a read‑only profile and source IP; HTTPS reachable from monitoring VM.
- **Advantages** — structured JSON for things SNMP doesn't expose (IPS archive packets, session detail, firmware status). Poll ≥ 30 s to avoid impacting the unit.

## 2.3 SNMP OID Reference

| Metric | OID | MIB |
|---|---|---|
| CPU usage | `1.3.6.1.4.1.12356.101.4.1.3.0` | FG‑SYSTEM‑MIB::fgSysCpuUsage |
| Memory usage | `1.3.6.1.4.1.12356.101.4.1.4.0` | FG‑SYSTEM‑MIB::fgSysMemUsage |
| Session count | `1.3.6.1.4.1.12356.101.4.1.8.0` | FG‑SYSTEM‑MIB::fgSysSesCount |
| Disk usage | `1.3.6.1.4.1.12356.101.4.1.6.0` | FG‑SYSTEM‑MIB::fgSysDiskUsage |
| HA system mode | `1.3.6.1.4.1.12356.101.13.1.1.0` | FG‑HA‑MIB::fgHaSystemMode |
| HA member index | `1.3.6.1.4.1.12356.101.13.2.1.1.<idx>` | FG‑HA‑MIB::fgHaMemberIndex |
| IPsec tunnel status | `1.3.6.1.4.1.12356.101.12.2.2.1.20.<idx>` | FG‑VPN‑MIB::fgVpnTunEntStatus |
| SSL‑VPN active logins | `1.3.6.1.4.1.12356.101.12.2.4.1.2.<idx>` | FG‑VPN‑MIB::fgVpnSslStatsLoginUsers |
| BGP peer state | `1.3.6.1.2.1.15.3.1.2.<peer‑IP>` | BGP4‑MIB::bgpPeerState |
| Interface in‑octets | `1.3.6.1.2.1.2.2.1.10.<ifIndex>` | IF‑MIB |
| Interface out‑octets | `1.3.6.1.2.1.2.2.1.16.<ifIndex>` | IF‑MIB |
| Interface in‑errors | `1.3.6.1.2.1.2.2.1.14.<ifIndex>` | IF‑MIB |

## 2.4 UTM Inspection — How / Requirements / Advantages

Each UTM profile below documents enablement, what to log, the dashboard signal, and the business value.

### 2.4.1 IPS (Intrusion Prevention)

- **How** — create an IPS sensor with FortiGuard signatures filtered to severity ≥ medium and the relevant OS targets; attach it to N/S and inter‑zone firewall policies. On each policy: `set logtraffic all`, `set ips-sensor "name"`, `set extended-log enable`.
- **Requirements** — active **FortiGuard IPS** subscription, syslog forwarding (§2.2 B), Loki / Grafana.
- **Logs produced** — `subtype=ips`, `attack=<name>`, `severity=`, `srcip=`, `dstip=`, `service=`, `action=detected|dropped|reset`.
- **Dashboard** — top 20 attacks last 24 h, severity heatmap, attackers by ASN / country, action distribution, IPS hit rate vs FortiGate CPU correlation.
- **Advantages** — detects and blocks known CVE exploitation, scanner activity, and lateral‑movement signatures for **both** N/S and E/W traffic, across all protocols (not just HTTP).

### 2.4.2 AntiVirus

- **How** — create an AV profile (flow‑based for performance, proxy‑based where deep inspection is required); attach to in/outbound policies carrying HTTP/S, SMTP, FTP, IMAP, POP3. On each policy: `set av-profile "name"`, `set logtraffic all`. Enable Cloud Sandbox submission if licensed.
- **Requirements** — active **FortiGuard AntiVirus** subscription, SSL Inspection where traffic is encrypted (otherwise AV is blind on HTTPS), syslog → Loki.
- **Logs produced** — `subtype=virus`, `virus=<name>`, `filename=`, `url=`, `srcip=`, `dstip=`, `action=blocked`.
- **Dashboard** — virus detections by host, by URL, by file type, 7 / 30‑day trend.
- **Advantages** — blocks known malware in transit (downloads, uploads, mail attachments) at the perimeter; clean audit trail for compliance; works for **all** protocols.

### 2.4.3 Application Control

- **How** — build an Application Control sensor: block categories such as `Proxy`, `P2P`, unsanctioned `Remote.Access`; monitor business apps; allow corporate SaaS. Attach to outbound user policies.
- **Requirements** — FortiGuard Application Control signatures (bundled with IPS in most SKUs); SSL Inspection for accurate identification of encrypted apps.
- **Logs produced** — `subtype=app-ctrl`, `app=<name>`, `cat=`, `action=block|pass|reset`.
- **Dashboard** — top apps blocked, top users hitting blocked apps, allowed‑but‑monitored anomalies.
- **Advantages** — visibility and policy enforcement on **shadow IT**, anonymisers, and tunnelling tools that an L4 firewall cannot see.

### 2.4.4 Web Filter

- **How** — enable a Web Filter profile blocking categories such as `Malicious Websites`, `Phishing`, `Newly Registered Domains`, `Spam URLs`; optionally log all categories for visibility; attach to user‑facing outbound policies.
- **Requirements** — FortiGuard Web Filtering subscription, SSL Inspection to inspect HTTPS, syslog → Loki.
- **Logs produced** — `subtype=webfilter`, `cat=`, `hostname=`, `url=`, `action=blocked|passthrough`.
- **Dashboard** — top blocked categories, top blocked hostnames, top blocked users.
- **Advantages** — prevents phishing and malware delivery at the gateway before content reaches the endpoint; provides a user → external‑site evidence trail without needing an external proxy.

### 2.4.5 DNS Filter

- **How** — configure a DNS Filter profile blocking phishing / malware / C2 / newly‑registered categories; apply on outbound policies that handle DNS. If all internal DNS is forced through FortiGate, this becomes a chokepoint detection point.
- **Requirements** — FortiGuard DNS subscription (often bundled with Web Filter); DNS forced through FortiGate (recursive resolver behind it OR explicit DNS policy).
- **Logs produced** — `subtype=dns`, `qname=`, `qtype=`, `cat=`, `action=block|redirect`.
- **Dashboard** — top blocked queries, **C2 / botnet category alerts (auto‑critical)**, host‑level repeat offenders.
- **Advantages** — catches infected hosts that beacon to malicious domains **before** they establish a TCP session; works on workloads where deep web inspection is impractical; works for non‑HTTP malware.

### 2.4.6 SSL / SSH Inspection

- **How** — deploy a **deep inspection** profile with a corporate CA trusted by clients (best); fall back to **certificate inspection** on policies where deep inspection is not allowed (banking, healthcare). Attach to UTM policies so IPS / AV / Web Filter can actually see encrypted payloads.
- **Requirements** — CA distributed to endpoints, exemption list for sensitive / compliance categories, CPU headroom on FortiGate.
- **Logs produced** — `subtype=ssl`, `action=block|allow`, `error=`, `event=ssl-anomaly`.
- **Dashboard** — SSL handshake errors, exempted vs inspected ratio, CPU vs inspection volume.
- **Advantages** — without it, every other UTM feature is partially blind on HTTPS — this is the multiplier that makes IPS / AV / Web Filter actually effective.

## 2.5 FortiGate Grafana Dashboards

- **HA Cluster Health** — HA mode, sync status, failover count (24 h), last failover timestamp, primary vs secondary CPU/mem/sessions side‑by‑side. *(SNMP)*
- **Platform Performance** — CPU%, memory%, sessions vs licensed max, session setup rate, disk usage, conserve‑mode flag. *(SNMP)*
- **Interface Throughput** — separate rows for N/S and E/W: bps in/out, % of link, error / drop rate. *(SNMP)*
- **Routing & VPN** — BGP peer state matrix, route count trend, IPsec tunnel up/down matrix, SSL‑VPN active users. *(SNMP + syslog for down events)*
- **UTM Security** — five tabs: **IPS · AntiVirus · App Control · Web Filter · DNS Filter** — each with block rate, top names, top sources, geo map. *(Loki via syslog)*
- **Admin & Compliance** — login attempts (success / failure), config‑change events with admin user + source IP, ITSM‑window violations highlighted. *(Loki)*

> Use Grafana template variables `$node` (primary / secondary) and `$vdom` to switch views without duplicating dashboards.

## 2.6 Alerting from FortiGate

| Alert | Source | Pipeline |
|---|---|---|
| CPU / memory / sessions over threshold | Prometheus (SNMP Exporter) | Alertmanager → Slack / PagerDuty |
| HA out‑of‑sync, failover event | Loki (syslog) | Grafana alert on LogQL rule |
| BGP peer down, IPsec tunnel down | Prometheus + Loki | Either path |
| IPS critical signature, DNS C2 hit | Loki | Grafana alert (page) |
| AV detection | Loki | Grafana alert (page) |
| Config change outside ITSM window | Loki | Grafana alert (ticket) |

---

# PART 3 — OCI Origins

## 3.1 Key Metrics to Monitor

| Metric | OCI Service | Threshold / Alert | Severity | Impact | Tool |
|---|---|---|---|---|---|
| VCN Ingress Throughput | VCN Flow Logs | Spike > 200% / 10 min | High | Possible ingress flood | OCI Monitoring + Grafana |
| VCN Egress Throughput | VCN Flow Logs | Spike > 200% / 10 min | High | Data exfil signal | OCI Monitoring + Grafana |
| Rejected Flow Count | VCN Flow Logs | > 1000/min on a subnet | High | NSG / Security List block surge | OCI Log Analytics |
| Top Rejected Source IPs | VCN Flow Logs | One IP > 500 denies/min | High | Scanning / brute force | OCI Log Analytics |
| LB Backend Health | OCI LB | Any backend unhealthy | Critical | Dropped traffic to dead backend | OCI Monitoring Alarms |
| LB 5xx Rate | OCI LB | > 2% | High | Origin application error | OCI Monitoring |
| LB Connection Refused | OCI LB | > 10/min | High | Backend pool exhausted | OCI Monitoring |
| Compute CPU (origin VMs) | OCI Compute | > 85% sustained | High | Origin overload | OCI Monitoring |
| Compute Memory (origin VMs) | OCI Compute | > 90% | High | OOM risk | OCI Monitoring (agent) |
| Block Volume IOPS | OCI Block Vol | > 80% provisioned | Medium | Storage bottleneck | OCI Monitoring |
| Block Volume Latency | OCI Block Vol | P99 > 5 ms | Medium | App latency impact | OCI Monitoring |
| DRG / FastConnect State | OCI Networking | Circuit down | Critical | On‑prem connectivity lost | OCI Monitoring |
| DRG Throughput | OCI Networking | > 80% capacity | High | On‑prem bandwidth saturation | OCI Monitoring |
| OCI Audit — IAM events | OCI Audit | Any unexpected privilege use | Critical | Compliance / security | OCI Audit → Loki / SIEM |
| Security List / NSG change | OCI Audit | Any change outside ITSM window | Critical | Unauthorized firewall change | OCI Audit |
| Object Storage 403 spike | OCI Object Storage | Spike in unauthorized | High | Data access anomaly | OCI Log Analytics |

## 3.2 VCN Flow Logs

- **How** — OCI Console → Logging → Log Groups → create `vcn-flow-logs`. Networking → VCN → Subnets → enable Flow Logs (start with DMZ, management, inter‑service; expand for cost control). Retention 30 days hot (90 days for compliance).
- **Requirements** — IAM policy `allow service loggingsearch to read log-content in tenancy`, OCI Logging enabled, Service Connector Hub for export.
- **Advantages** — the OCI‑native way to see accepted / rejected packets between subnets and outbound without sidecar agents on every VM.

### Field reference

| Field | Type | Use |
|---|---|---|
| `action` | ACCEPT / REJECT | Deny dashboards, security alerts |
| `sourceAddress` / `destinationAddress` | IP | Top‑N, lateral movement, scanning |
| `sourcePort` / `destinationPort` | int | Unexpected ports from origin VMs |
| `bytesIn` / `bytesOut` | int | Throughput / exfil |
| `packets` | int | High packets + low bytes = port scan |
| `protocol` | int | TCP=6, UDP=17, ICMP=1 |
| `vcnId` / `subnetId` | OCID | Scope per subnet |
| `startTime` / `endTime` | ts | Duration analysis |

### Export options (pick one)

- **A** — Service Connector Hub → Streaming (Kafka) → Loki *(recommended, real‑time)*
- **B** — Service Connector Hub → Object Storage → Logstash / Vector → Loki / Elasticsearch
- **C** — OCI Log Analytics native + OCI Log Analytics Grafana plugin

## 3.3 OCI Monitoring — Native Alarms

- **Load Balancer** (`oci_lbaas`) — `HttpRequests`, `HttpResponses5xx`, `BackendTimeouts`, `UnhealthyBackendCount`
- **Compute** (`oci_computeagent`) — `CpuUtilization`, `MemoryUtilization` (requires Monitoring agent)
- **Block Volume** (`oci_blockstore`) — `VolumeReadOps`, `VolumeWriteOps`, `VolumeReadThroughput`, `VolumeWriteThroughput`
- **DRG / FastConnect** (`oci_fastconnect`) — `ConnectionState`
- Route alarms to OCI Notifications (email, Slack via HTTPS, PagerDuty) or OCI Functions for auto‑remediation.

## 3.4 OCI Audit Log — Security & Compliance

- Every API call in the tenancy is recorded.
- Forward to Loki (via Service Connector Hub → Streaming) or to your SIEM. Native retention 90 days.
- Key events to alert on: `CreateVirtualNetwork`, `UpdateSecurityList`, `UpdateNetworkSecurityGroup`, `CreatePolicy`, `DeletePolicy`, `CreateUser`, `AddUserToGroup`, `UpdateUserCapabilities`.

## 3.5 OCI Grafana Dashboards

- **VCN Traffic** — ingress / egress bps per subnet, accept vs reject counts, top src / dst IPs, protocol mix.
- **Origin Health** — LB backend health map, LB 5xx rate, LB latency P50 / P95, compute CPU / memory heatmap.
- **Security Deny Map** — rejected flows by source IP (Geomap), top denied destination ports, deny trend.
- **Infrastructure Ops** — block volume IOPS / latency, DRG circuit state, OCI service health.

---

# PART 4 — End‑to‑End Latency & Synthetic Monitoring

## 4.0 Path decomposition

- **Segment A** — Client → Cloudflare edge: DNS + TCP + TLS
- **Segment B** — Cloudflare → FortiGate (origin connect): `OriginResponseDurationMs`
- **Segment C** — FortiGate processing: inferred via correlated CPU + session latency
- **Segment D** — FortiGate → OCI LB: VCN internal hop (typically < 1 ms)
- **Segment E** — OCI LB → Origin VM: backend response time from OCI LB metric

## 4.1 Key Metrics

| Metric | Scope | Threshold | Severity | Tool |
|---|---|---|---|---|
| Full‑path latency P95 | CF → FG → Origin | > 3000 ms | Critical | Grafana synthetic / Blackbox |
| Full‑path latency P50 | CF → FG → Origin | > 800 ms | High | Grafana |
| Synthetic HTTP UP / DOWN | External URL | Any DOWN | Critical | Blackbox Exporter |
| TLS validity | External URL | Cert < 14 d | High | Blackbox / CF API |
| Hop‑by‑hop break | CF → FG → LB → VM | Any hop > 500 ms | High | CF Logpush + LB + Blackbox |
| DNS resolution time | DNS | P95 > 150 ms | Medium | Blackbox / CF DNS Analytics |
| Packet loss on path | Network | > 0.5% | High | MTR + ICMP Blackbox + OCI Network Path Analyzer |
| VPN tunnel latency | FG VPN | RTT > 150 ms | Medium | FG ping probes |
| FG internal processing delay | FG | CPU > 80% AND latency spike | High | Correlated rule |
| Origin response P95 | OCI LB / VM | > 1000 ms | High | OCI Monitoring |
| Availability SLO | E2E | < 99.9% | Critical | Grafana SLO panel |

## 4.2 Tooling

| Tool | Type | Role | Complexity |
|---|---|---|---|
| Prometheus Blackbox Exporter | OSS | HTTP / HTTPS / TCP / ICMP probes (OCI + external VM) | Low |
| Grafana | OSS | Dashboards, alerts, SLO | Medium |
| OCI Network Path Analyzer | Native OCI | Path trace between OCI resources | Low |
| OCI Monitoring alarms | Native OCI | Latency / health alarms | Low |
| MTR / traceroute cron | CLI | Scheduled hop probes from FG / OCI VM | Low |
| Cloudflare Logpush → Loki | CF + OSS | Real P50 / P95 from real traffic | Medium |

## 4.3 Synthetic Probe Architecture

### Internal probes (OCI monitoring VM)

- HTTP to origin LB private IP → measures D + E
- ICMP to FortiGate inside interface → OCI‑internal packet loss
- TCP to FortiGate mgmt port → FG availability

### External probes (outside OCI, simulating a client)

- HTTPS to public domain → full path A + B + C + D + E
- DNS probe to authoritative NS (Cloudflare) → DNS resolution time
- TLS expiry: warn 30 d, critical 14 d

## 4.4 Latency Correlation Workflow

1. **Detect** — Grafana alert on full‑path P95.
2. **Isolate** — per‑segment dashboard: is CF edge latency normal? FG CPU spiking? LB backend time elevated?
3. **Confirm** — cross‑reference SNMP (FG CPU / sessions), VCN flow logs (drops), CF Logpush (`OriginResponseDurationMs`), OCI LB metrics.
4. **Resolve** — route to the right team: CF / DNS / TLS → CDN team, FG → network ops, origin → app / infra.

## 4.5 SLO / Error Budget Dashboard

- SLO example — 99.9% of HTTP requests return 2xx within 2000 ms over 30 days.
- Error budget — 0.1% of requests ≈ 43 minutes of downtime / month.
- Grafana recording rules compute SLI (success ratio) and burn rate.
- Alert on **fast burn** (1‑h burn rate > 14× → page) and **slow burn** (6‑h burn rate > 6× → ticket).
- Panels — SLO compliance % (30 d), error budget remaining, burn rate chart, top error causes.

---

# Implementation Effort Summary

Effort assumes 1–2 engineers with experience in OCI, FortiGate, and Grafana. Numbers in engineer‑days.

| Part | Activity | Effort | Complexity | Dependencies | Deliverable |
|---|---|---|---|---|---|
| 1 | Cloudflare Logpush (`http_requests`) → Loki | 2–4 | Medium | CF plan that includes Logpush | Log pipeline + dashboards |
| 1 | Grafana CF plugin + Traffic / Error / DNS / TLS dashboards | 2–3 | Low‑Med | CF API token | CF Grafana dashboards |
| 1 | Cloudflare Notifications + Grafana alert rules | 1–2 | Low | Dashboards live | Alert routing |
| 2 | FortiGate SNMP v3 + read‑only API user | 1–2 | Low | FW management access | SNMP / API live |
| 2 | Prometheus + SNMP Exporter (FortiGate generator) on OCI | 3–5 | Medium | OCI VM, Security List rules | Metrics pipeline |
| 2 | FortiGate Grafana dashboards (HA, perf, IF, VPN, BGP) | 4–6 | Medium | SNMP active | Core FG dashboards |
| 2 | Syslog → Promtail → Loki pipeline | 3–5 | Medium | Loki, FortiGate syslog config | Security log analytics |
| 2 | UTM dashboards: IPS / AV / AppCtrl / Web Filter / DNS Filter | 3–5 | Medium | Syslog pipeline + UTM profiles applied | UTM security dashboards |
| 2 | Alerting rules for UTM + admin / config‑change | 2–3 | Low‑Med | UTM dashboards | Alerts to Slack / PD |
| 3 | OCI VCN Flow Logs (critical subnets) | 1 | Low | OCI IAM | Flow logs streaming |
| 3 | Service Connector Hub → Streaming → Loki | 2–3 | Medium | Flow logs enabled | Flow log dashboards |
| 3 | OCI Monitoring alarms (LB, Compute, DRG) | 2–3 | Low | OCI Monitoring | Alarm notifications |
| 3 | OCI Audit → Loki + alert rules | 2–3 | Medium | Logging pipeline | Audit alerts |
| 4 | Blackbox Exporter (internal + external) + probes | 2–3 | Low | OCI VM + external VM | Synthetic checks |
| 4 | Hop‑by‑hop latency dashboards | 3–4 | Medium | Blackbox + Loki | Latency breakdown |
| 4 | OCI Network Path Analyzer setup | 1 | Low | OCI permissions | Path trace ready |
| 4 | SLO / Error Budget panel | 2–3 | Medium | All data sources | SLO dashboard |
| All | Threshold tuning + 1‑week baseline | 3–5 | Medium | All above active | Tuned alert rules |
| All | Runbooks + documentation | 3–5 | Low | Post‑implementation | Runbook library |

| Phase / Part | Effort (eng‑days) | Key Outcome |
|---|---|---|
| Part 1 — Cloudflare | 5–9 | Traffic, HTTP error codes, origin latency, DNS and TLS dashboards in Grafana |
| Part 2 — FortiGate HA + UTM | 15–24 | Full FG observability incl. IPS / AV / App‑Ctrl / Web Filter / DNS Filter via syslog → Loki |
| Part 3 — OCI Origins | 7–10 | VCN flow logs, OCI alarms, LB / compute dashboards |
| Part 4 — E2E Latency | 8–11 | Synthetic probes, latency breakdown, SLO dashboard |
| Cross‑cutting | 6–10 | Tuned thresholds, runbooks, alert playbooks |
| **TOTAL** | **41–64 eng‑days** | Full observability across all four layers |

> Suggested phasing — Part 1 (CF) and Part 3 (OCI alarms + flow logs) in parallel as Phase 1 quick wins; Part 2 (FortiGate + UTM) and Part 4 (E2E) in Phase 2.

---

# Discussion Points for Manager Review

- **Part 1 — Cloudflare** — confirm the Cloudflare plan tier and whether Logpush for the `http_requests` dataset is available; agree on retention for HTTP logs.
- **Part 2 — FortiGate UTM** — confirm active FortiGuard subscriptions for **IPS, AntiVirus, Web / DNS Filtering, Application Control**; confirm scope of **SSL Inspection** (deep vs certificate, exemption list for compliance); agree syslog destination = Loki / Promtail stack.
- **Part 3 — OCI** — confirm IAM permissions for VCN Flow Logs and Service Connector Hub; choose retention (30 d hot / 90 d cold).
- **Part 4 — E2E** — agree external probe location (separate cloud region or ISP‑hosted VM).
- **Alerting** — define on‑call rotation owner and select PagerDuty vs native OCI Notifications vs Slack‑only.
- **Baseline** — schedule a 1‑week baselining window before locking FG CPU / session / IPS rate thresholds.
