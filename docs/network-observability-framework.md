# Network Observability Framework

**Cloudflare (CDN / DDoS / DNS / TLS) · FortiGate HA with UTM · OCI Origins · End‑to‑End Latency**

Metrics · Sources · Alerts · Thresholds · Tools · Dashboards · How / Requirements / Advantages

Version 2.0 · Network Operations

---

## Scope and Assumptions

This document reflects the **products that are actually in production**:

- **Cloudflare** is used for **DNS, CDN, TLS termination, L3/4 + L7 DDoS protection, basic Firewall Events / IP Access Rules / Managed Challenge, and edge analytics**. **WAF (Managed Rulesets) is NOT in scope** and is not referenced anywhere in this document.
- **FortiGate HA cluster** runs the full **UTM stack**: **IPS, AntiVirus, Application Control, Web Filter, DNS Filter, SSL/SSH Inspection**, in addition to stateful firewalling, IPsec/SSL VPN, and BGP routing. **FortiAnalyzer (FAZ) is NOT deployed** — all logs are exported by **syslog** to the open‑source pipeline (Promtail → Loki → Grafana) and/or to the existing SIEM.
- **OCI** hosts the origins (VCN, Load Balancers, Compute, Block Volume, DRG/FastConnect) and provides VCN Flow Logs, OCI Monitoring, and OCI Audit.
- **Observability stack**: Prometheus + SNMP Exporter + Blackbox Exporter, Loki (via Promtail), Grafana (dashboards + alerting), routed to Slack / PagerDuty / Email.

## Traffic Flow Architecture

```
Client
  │
  ▼
Cloudflare Edge   ── DNS · CDN · TLS · L3/4+L7 DDoS · Firewall Events · IP Access Rules · Rate Limiting · Bot Score
  │
  ▼
FortiGate HA      ── Stateful FW · IPsec/SSL VPN · BGP · UTM (IPS, AV, App‑Ctrl, Web/DNS Filter, SSL Inspection)
  │
  ▼
OCI VCN           ── Subnets · Security Lists / NSGs · Flow Logs
  │
  ▼
OCI LB / Origin VMs / Block Volume / DRG (on‑prem)
```

Each layer is monitored independently and correlated end‑to‑end for latency, errors, and security visibility.

---

# PART 1 — Cloudflare (no WAF)

## 1.0 What we DO have on Cloudflare

| Capability | Where it lives in the dashboard | Visibility produced |
|---|---|---|
| **DNS** | DNS → Records, DNS Analytics | Query rate, response codes, top names |
| **CDN / Cache** | Caching → Configuration / Analytics | Hit ratio, bandwidth saved |
| **TLS / SSL** | SSL/TLS → Edge Certificates | Cert validity, TLS version, handshake errors |
| **L3/4 DDoS Protection** | Security → DDoS | Mitigation events, attack vector, pps/bps blocked |
| **L7 DDoS Protection** | Security → DDoS | HTTP DDoS rule triggers, blocked requests |
| **IP Access Rules** (Tools / Firewall) | Security → WAF → Tools (still part of CF without paid WAF) | Block / Challenge events per IP / ASN / Country |
| **Custom Firewall Rules** (free tier ships 5) | Security → WAF → Custom rules | Blocked / challenged requests + matched rule |
| **Rate Limiting (basic, free tier)** | Security → WAF → Rate limiting rules | 429 events, top offenders |
| **Managed Challenge / Bot Score** | Security → Bots (free Bot Fight Mode) | Likely automated traffic, challenged requests |
| **Security Events log** | Security → Events | Per‑request: who, what action, which rule |
| **Browser Insights (RUM)** | Analytics → Web Analytics | Real‑user TTFB, LCP, FCP, CLS |
| **Health Checks** | Traffic → Health Checks | Active probes from CF edge to origin |
| **Logpush** (Pro/Business/Enterprise) | Analytics → Logs → Logpush | Streamed raw HTTP logs / Firewall Events / DNS logs |

> ✦ **Note on terminology** — the “Security Events” / “Firewall Events” feed in the Cloudflare dashboard is the same dataset that paid WAF customers see. We do not use WAF Managed Rulesets, but we still get full visibility on blocked / challenged / bad‑packet events from DDoS, IP Access Rules, Custom Rules, Rate Limiting, and Bot Fight Mode.

## 1.1 Key Metrics to Monitor

| Metric | Category | Threshold / Alert | Severity | Impact | Source |
|---|---|---|---|---|---|
| HTTP Request Rate | Traffic | Spike > 3× baseline in 5 min | High | Possible attack or viral traffic | CF Analytics API / Logpush |
| HTTP 4xx Rate | Traffic | > 5% sustained 5 min | Medium | Client / config issue | CF Analytics / Logpush |
| HTTP 5xx Rate | Traffic | > 1% sustained 5 min | High | Origin failure | CF Analytics / Logpush |
| Cache Hit Ratio | Performance | < 70% sustained | Medium | Origin overload risk | CF Cache Analytics |
| Bandwidth Consumed | Traffic / Cost | Spike > 200% | Medium | DDoS or cost signal | CF Analytics |
| **DDoS Mitigation Events (L3/4 + L7)** | Security | Any active mitigation | Critical | Service availability at risk | CF DDoS Analytics / Logpush dataset `firewall_events` |
| **Firewall Events – action = block / challenge** | Security | Spike > 3× baseline | High | Attack pattern, bad packets blocked | Security Events / Logpush |
| **IP Access Rule hits (per country / ASN / IP)** | Security | Any single source > 500 blocks/min | High | Scanning / brute force | Security Events |
| **Rate‑Limiting Rule Hits (429)** | Security | Sustained > 200/min | High | Abuse / credential stuffing | Security Events |
| **Bot Fight Mode / Bot Score** | Security | Challenged traffic > 40% of total | High | Automated abuse | Security Events / Logpush |
| **Managed Challenge solve rate** | Security | Drop in solve rate | Medium | Legit user friction or pure‑bot wave | Security Events |
| SSL / TLS Handshake Errors | TLS | Error rate > 1% | Medium | Client connectivity failures | CF Analytics |
| Origin Response Time (P95) | Performance | > 2000 ms | High | Degraded UX | CF Logpush `OriginResponseDurationMs` |
| DNS Query Rate / NXDOMAIN | DNS | NXDOMAIN > 5% of total | Medium | Misconfig or DNS abuse | CF DNS Analytics |
| Cert Expiry | TLS | < 14 days | High | Outage risk | CF Edge Certificates / API |
| Health Check status | Availability | Any DOWN | Critical | Origin unreachable from CF edge | CF Health Checks |
| Browser Insights – TTFB | RUM | P95 > 1500 ms | High | Real‑user slowness | CF Web Analytics |

## 1.2 How to get Cloudflare data into Grafana

### Option A — Cloudflare official Grafana data‑source plugin (quick start)

- **How**: install `grafana-cloudflare-datasource` from the Grafana plugin catalogue, configure with a CF API token (permissions: `Zone → Analytics → Read`, `Account → Analytics → Read`).
- **Requirements**: CF account, API token scoped read‑only to the zone(s).
- **Advantages**: zero pipeline to maintain; gives traffic, bandwidth, cache, errors, top countries; works on all CF plans.
- **Limitation**: aggregated (1‑min minimum); no per‑request fields, so cannot derive P95 origin latency or per‑rule firewall breakdown.

### Option B — Logpush → Loki (recommended for full visibility of blocked / bad packets)

- **How**:
  1. CF Dashboard → Analytics → Logs → **Logpush** → Add destination.
  2. Use HTTP destination pointing at a Loki gateway (or S3 → Promtail → Loki).
  3. Enable two datasets: **`http_requests`** and **`firewall_events`**.
  4. In Grafana create a Loki data‑source and import / build dashboards using LogQL.
- **Recommended fields** (`http_requests`): `ClientIP`, `ClientCountry`, `ClientASN`, `ClientRequestHost`, `ClientRequestURI`, `EdgeResponseStatus`, `OriginResponseStatus`, `OriginResponseDurationMs`, `CacheCacheStatus`, `ClientSSLProtocol`, `EdgeRateLimitAction`, `EdgePathingStatus`, `EdgePathingOp`, `EdgePathingSrc`, `RayID`, `BotScore`, `BotScoreSrc`.
- **Recommended fields** (`firewall_events`): `Action` (`block`, `challenge`, `jschallenge`, `managed_challenge`, `log`), `RuleID`, `Source` (`firewallCustom`, `ipAccessRule`, `rateLimit`, `bic`, `botFight`, `l7ddos`, `dlp`), `ClientIP`, `ClientCountry`, `ClientASN`, `ClientRequestHost`, `ClientRequestPath`, `Datetime`, `EdgeColoCode`.
- **Requirements**: Cloudflare Pro / Business / Enterprise (Logpush requires paid tier; **Enterprise required for `firewall_events` with full fields**). Loki + Promtail or Vector deployed in OCI.
- **Advantages**:
  - Full per‑request visibility including **why a packet was blocked, by which rule, from which source**.
  - Lets you build the **Threat / Block Map** Grafana panels we describe in §1.4.
  - Enables P50/P95/P99 origin latency and TTFB derivations from real traffic, not synthetic.

### Option C — Prometheus scraping the Analytics API (fallback / all plans)

- **How**: deploy `cloudflare_exporter` (community) on an OCI VM, scrape `/zones/{id}/analytics/dashboard` and `/zones/{id}/firewall/events` every 60s, ingest into Prometheus.
- **Requirements**: CF API token (read‑only Analytics + Firewall).
- **Advantages**: works on all CF plans; cheap and simple; no log ingestion costs.
- **Limitation**: aggregated; no per‑rule, per‑IP firewall event detail.

## 1.3 Recommended Cloudflare Grafana Dashboards

| Panel | Source | LogQL / Query (example) | Notes |
|---|---|---|---|
| Request rate by status code | Logpush → Loki | `sum by (status) (count_over_time({source="cloudflare", dataset="http_requests"} | json | __error__="" [5m]))` | Single‑pane health view |
| **Blocked / Challenged events timeline** | Logpush `firewall_events` → Loki | `sum by (Source) (count_over_time({source="cloudflare", dataset="firewall_events"} | json | Action=~"block|challenge|managed_challenge|jschallenge" [5m]))` | **Replaces WAF Events panel**; uses DDoS + IP Access + Custom + Rate Limit |
| Geo block map | Logpush `firewall_events` → Loki | Group by `ClientCountry`, action ≠ allow | Grafana Geomap |
| Top blocked source IPs / ASNs | Logpush `firewall_events` → Loki | `topk(20, sum by (ClientIP, ClientASN) (count_over_time(...[15m])))` | Feeds IP Access Rule tuning |
| Rule effectiveness (which rule blocks most) | Logpush `firewall_events` → Loki | Group by `Source` and `RuleID` | Identifies stale or noisy rules |
| Cache hit ratio | CF Analytics plugin | `cacheStatus` breakdown | Use plugin, no Logpush needed |
| Origin latency P50 / P95 / P99 | Logpush → Loki | `histogram_quantile(0.95, sum(rate({…} | json | unwrap OriginResponseDurationMs [5m])) by (le))` | Needs Logpush |
| DDoS mitigation timeline | CF DDoS Analytics + Logpush | `firewall_events` where `Source="l7ddos"` | Critical alert source |
| TLS handshake errors | CF Analytics plugin | TLS error count by version | Cert / cipher misconfig signal |
| RUM TTFB / LCP | CF Web Analytics | TTFB P95 | No setup beyond enabling Browser Insights |

## 1.4 Cloudflare Alerting

| Channel | What it covers | How |
|---|---|---|
| **Cloudflare Notifications** (Dashboard → Notifications) | DDoS attack started, Health Check fail, Origin Error rate, Certificate expiry, Logpush job failure | Built‑in, no pipeline. Route to email / Slack webhook / PagerDuty. |
| **Grafana alerting on Loki queries** | 5xx > 2%, blocked event rate > N, origin P95 > 2 s, rate‑limit storms | Alert rules in Grafana → Slack / PagerDuty |
| **Cloudflare Health Checks** | Origin reachability from CF edge (active probe) | Traffic → Health Checks; notification → email / PD |
| **Browser Insights** | Real‑user TTFB / Core Web Vitals regressions | Manual review or scrape via API |

---

# PART 2 — FortiGate HA Cluster (UTM, no FortiAnalyzer)

The FortiGate HA pair is the central hub for north‑south and east‑west traffic, **and** the primary security inspection point now that Cloudflare is not running WAF. Everything in this section is delivered with **SNMP v3 + syslog only** — no FortiAnalyzer is required.

## 2.1 Key Metrics to Monitor

| Metric | Domain | Threshold / Alert | Severity | Impact | Source |
|---|---|---|---|---|---|
| CPU Utilization | Platform | > 80% sustained | Critical | Packet drops, latency spike | SNMP `fgSysCpuUsage` |
| Memory Utilization | Platform | > 85% sustained | Critical | Session table pressure | SNMP `fgSysMemUsage` |
| Active Session Count | Platform | > 90% of licensed max | Critical | New connections refused | SNMP `fgSysSesCount` |
| Session Setup Rate | Platform | > 3× baseline | High | DoS / surge signal | SNMP + delta |
| **HA Sync Status** | HA | Out‑of‑sync > 5 min | Critical | Single point of failure | SNMP `fgHaSystemMode` + `fgHaStatsSyncStatus` |
| **HA Failover Event** | HA | Any failover | Critical | Service interruption window | Syslog event `LOG_ID_HA_…` |
| N/S Interface Throughput | Capacity | > 80% link speed | High | Latency, customer impact | SNMP `ifInOctets` / `ifOutOctets` |
| E/W Interface Throughput | Capacity | > 80% link speed | High | Inter‑service latency | SNMP IF‑MIB |
| Interface Errors / Drops | Capacity | > 0.5% of packets | High | Silent traffic loss | SNMP `ifInErrors` + Blackbox ICMP |
| BGP Peer State | Routing | Down | Critical | Routing blackhole | SNMP BGP4‑MIB + syslog |
| BGP Route Count | Routing | Drop > 20% in 5 min | High | Partial routing loss | SNMP / delta |
| IPsec Tunnel Status | VPN | Down | Critical | Site / partner offline | SNMP `fgVpnTunEntStatus` |
| IPsec Tunnel Throughput | VPN | > 80% of capacity | Medium | VPN saturation | SNMP |
| SSL‑VPN Active Users | VPN | > 90% of license | Medium | Remote access exhausted | SNMP `fgVpnSslStatsLoginUsers` |
| **IPS Signature Hits** | UTM – IPS | > 500 / min, OR any “critical” severity | High / Critical | Active exploit attempt | Syslog `subtype=ips` |
| **AV / Malware Detections** | UTM – AntiVirus | Any detection | High | Malware in transit, block proves UTM works | Syslog `subtype=virus` |
| **Application Control blocks** | UTM – AppCtrl | Spike > 3× baseline | Medium | Policy violations / shadow IT | Syslog `subtype=app-ctrl` |
| **Web Filter blocks** | UTM – Web Filter | Spike > 3× baseline | Medium | Phishing / malicious URL hits | Syslog `subtype=webfilter` |
| **DNS Filter blocks** | UTM – DNS Filter | Any C2 / botnet category hit | Critical | Compromised host beaconing | Syslog `subtype=dns` |
| **SSL Inspection errors** | UTM – SSL | Error rate > 1% | Medium | Broken inspection = blind spot | Syslog `subtype=ssl` |
| Policy Deny Rate | Firewall | Spike > 300% | Medium | Misconfig or attack | Syslog `forward` with action=deny |
| Admin Login Failures | Operations | > 5 failures / 10 min | High | Brute‑force attempt | Syslog `subtype=system` event id `login` |
| Config Change Events | Operations | Any change outside ITSM window | Critical | Unauthorized change | Syslog `subtype=system` event id `cfg-change` |
| Disk / Log Usage | Operations | > 80% | Medium | Log loss | SNMP `fgSysDiskUsage` |
| Hardware Temperature | Operations | Above vendor threshold | Medium | Hardware failure risk | SNMP FortiGate sensor MIB |

## 2.2 Data Sources

### A) SNMP v3 Polling — performance, HA, interfaces, VPN, routing

- **How**:
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
  Restrict SNMP via the trust‑host list **and** an OCI Security List / NSG that only permits the Prometheus VM.
  Poll with **SNMP Exporter** (Prometheus) every 30 s for live metrics, 5 min for capacity/disk.
- **Requirements**: SNMP v3 user with AuthPriv (SHA‑256 + AES‑256), reachable monitoring subnet, Prometheus + SNMP Exporter, FortiGate generators file in SNMP Exporter (community module exists).
- **Advantages**: numeric metrics directly into Prometheus → Grafana; cheap, low CPU on FortiGate; works for every metric in §2.1 except security event detail.

### B) Syslog forwarding — UTM events, security, admin/config

- **How**:
  ```
  config log syslogd setting
      set status enable
      set server <syslog-collector-ip>
      set port 514
      set mode reliable          ! TCP
      set facility local6
      set format default          ! or "csv" / "cef"
      set source-ip <fgt-mgmt-ip>
  end
  config log syslogd filter
      set severity information
      set forward-traffic enable
      set local-traffic enable
      set event enable
      set anomaly enable          ! IPS denial of service
  end
  config log eventfilter
      set system enable
      set vpn enable
      set router enable
      set user enable
      set ha enable
  end
  ```
  Collector = **Promtail** (or rsyslog → Promtail) → **Loki**. Parse with a Promtail pipeline that extracts FortiGate KV pairs (`type=`, `subtype=`, `action=`, `srcip=`, `dstip=`, `service=`, `attack=`, `severity=`, `virus=`, `app=`, `cat=`, …).
- **Requirements**: syslog reachable over TCP 514 from FortiGate management/HA‑mgmt VIP; Promtail config with FortiGate pipeline; Loki retention (recommend 90 days hot).
- **Advantages**:
  - Replaces FortiAnalyzer for the visibility we need (IPS, AV, AppCtrl, Web/DNS Filter, admin, config‑change, HA events).
  - Single search surface in Grafana Explore (Loki) alongside Cloudflare logs and OCI flow logs.
  - Open‑source, no per‑GB FAZ licensing.

### C) FortiGate REST API — on‑demand drilldowns and dashboards

- **How**: create a read‑only REST admin profile + API key, call `/api/v2/monitor/system/resource/usage`, `/api/v2/monitor/vpn/ipsec`, `/api/v2/monitor/router/bgp/neighbors`, `/api/v2/monitor/utm/ips-archive`, etc. Use as a Grafana JSON API data‑source for ad‑hoc panels.
- **Requirements**: API token bound to a read‑only profile and source IP, HTTPS reachable from monitoring VM.
- **Advantages**: gives structured JSON for things SNMP doesn’t expose (IPS archive packets, current sessions detail, current firmware status). Poll ≥ 30 s to avoid impacting the unit.

## 2.3 SNMP OID Reference

| Metric | OID | MIB |
|---|---|---|
| CPU usage | `1.3.6.1.4.1.12356.101.4.1.3.0` | FG‑SYSTEM‑MIB::`fgSysCpuUsage` |
| Memory usage | `1.3.6.1.4.1.12356.101.4.1.4.0` | FG‑SYSTEM‑MIB::`fgSysMemUsage` |
| Session count | `1.3.6.1.4.1.12356.101.4.1.8.0` | FG‑SYSTEM‑MIB::`fgSysSesCount` |
| Disk usage | `1.3.6.1.4.1.12356.101.4.1.6.0` | FG‑SYSTEM‑MIB::`fgSysDiskUsage` |
| HA system mode | `1.3.6.1.4.1.12356.101.13.1.1.0` | FG‑HA‑MIB::`fgHaSystemMode` |
| HA member index | `1.3.6.1.4.1.12356.101.13.2.1.1.<idx>` | FG‑HA‑MIB::`fgHaMemberIndex` |
| IPsec tunnel status | `1.3.6.1.4.1.12356.101.12.2.2.1.20.<idx>` | FG‑VPN‑MIB::`fgVpnTunEntStatus` |
| SSL‑VPN active logins | `1.3.6.1.4.1.12356.101.12.2.4.1.2.<idx>` | FG‑VPN‑MIB::`fgVpnSslStatsLoginUsers` |
| BGP peer state | `1.3.6.1.2.1.15.3.1.2.<peer‑IP>` | BGP4‑MIB::`bgpPeerState` |
| Interface in‑octets | `1.3.6.1.2.1.2.2.1.10.<ifIndex>` | IF‑MIB |
| Interface out‑octets | `1.3.6.1.2.1.2.2.1.16.<ifIndex>` | IF‑MIB |
| Interface in‑errors | `1.3.6.1.2.1.2.2.1.14.<ifIndex>` | IF‑MIB |

## 2.4 UTM Inspection — How to enable, requirements, advantages

For each UTM profile we (a) document the **CLI / GUI enablement**, (b) what to **log**, (c) the **dashboard signal** in Grafana via Loki, and (d) the **business value**.

### 2.4.1 IPS (Intrusion Prevention)

- **How**: create an IPS sensor with the relevant Fortinet signature DB filters (severity ≥ medium, OS = Linux/Windows depending on origin), attach it to north‑south and inter‑zone firewall policies. Enable `set logtraffic all` and `set ips-sensor "name"` on each policy. Enable `set extended-log enable`.
- **Requirements**: active **FortiGuard IPS** subscription, syslog forwarding (§2.2B), Loki/Grafana for visualisation.
- **Logs produced**: `subtype=ips`, `attack=<name>`, `severity=`, `srcip=`, `dstip=`, `service=`, `action=detected|dropped|reset`.
- **Dashboard**: top 20 attacks last 24 h, severity heatmap, attackers by ASN/country, action distribution, IPS hit rate vs FortiGate CPU (proves correlation).
- **Advantages**: closes the gap left by not running Cloudflare WAF — known CVE exploitation, scanner activity, lateral movement signatures are caught at the network gateway for **both** north‑south and east‑west traffic; not limited to HTTP like a WAF.

### 2.4.2 AntiVirus

- **How**: create an AV profile (flow‑based for performance, proxy‑based where SSL inspection is deep‑packet); attach to outbound and inbound policies that carry HTTP/S, SMTP, FTP, IMAP, POP3 as applicable. Enable `set av-profile "name"`, `set logtraffic all`. Enable Cloud Sandbox submission if licensed.
- **Requirements**: active **FortiGuard AntiVirus** subscription, SSL Inspection where traffic is encrypted (otherwise AV is blind on HTTPS), syslog → Loki.
- **Logs produced**: `subtype=virus`, `virus=<name>`, `filename=`, `url=`, `srcip=`, `dstip=`, `action=blocked`.
- **Dashboard**: virus detections by host, by URL, by file type, trend over 7/30 days.
- **Advantages**: blocks known malware in transit (downloads, uploads, email attachments) at the perimeter, generates a clear audit trail for compliance, and works for **all** protocols, not just web.

### 2.4.3 Application Control

- **How**: build an Application Control sensor — block categories (e.g., `Proxy`, `P2P`, `Remote.Access` unsanctioned), monitor business apps, allow corporate SaaS. Attach to outbound user policies.
- **Requirements**: FortiGuard Application Control signatures (bundled with the IPS subscription on most plans), SSL Inspection for accurate identification of encrypted apps.
- **Logs produced**: `subtype=app-ctrl`, `app=<name>`, `cat=`, `action=block|pass|reset`.
- **Dashboard**: top apps blocked, top users hitting blocked apps, allowed‑but‑monitored anomalies.
- **Advantages**: visibility and policy enforcement on **shadow IT**, anonymisers, and tunnelling tools that an L4 firewall cannot see.

### 2.4.4 Web Filter

- **How**: enable a Web Filter profile blocking categories such as `Malicious Websites`, `Phishing`, `Newly Registered Domains`, `Spam URLs`. Optionally log all categories for visibility. Attach to user‑facing outbound policies.
- **Requirements**: FortiGuard Web Filtering subscription, SSL Inspection to inspect HTTPS, syslog → Loki.
- **Logs produced**: `subtype=webfilter`, `cat=`, `hostname=`, `url=`, `action=blocked|passthrough`.
- **Dashboard**: top blocked categories, top blocked hostnames, top blocked users.
- **Advantages**: prevents phishing and malware delivery at the proxy/firewall before content reaches the endpoint; supplies the “user → external website” evidence trail without needing an external proxy.

### 2.4.5 DNS Filter

- **How**: configure a DNS Filter profile blocking the same security categories as Web Filter (phishing, malware, C2, newly registered). Apply on outbound policies that handle DNS; if all DNS is forced through FortiGate, this becomes a chokepoint detection.
- **Requirements**: FortiGuard DNS subscription (bundled with Web Filter on most SKUs), DNS forced through FortiGate (recursive resolver behind it or explicit DNS policy).
- **Logs produced**: `subtype=dns`, `qname=`, `qtype=`, `cat=`, `action=block|redirect`.
- **Dashboard**: top blocked queries, **C2 / botnet category alerts (auto‑critical)**, host‑level repeat offenders.
- **Advantages**: catches infected hosts that beacon to malicious domains even **before** they establish a TCP session — works on workloads where deep web inspection is impractical, and works for non‑HTTP malware.

### 2.4.6 SSL / SSH Inspection

- **How**: deploy a “deep inspection” profile with a corporate CA trusted by clients, OR “certificate inspection” at minimum on policies where deep inspection is not possible (e.g., banking, healthcare). Attach to UTM policies so IPS/AV/Web Filter can actually see encrypted payloads.
- **Requirements**: CA distributed to endpoints, exemption list for sensitive categories (compliance), CPU headroom on FortiGate.
- **Logs produced**: `subtype=ssl`, `action=block|allow`, `error=`, `event=ssl-anomaly`.
- **Dashboard**: SSL handshake errors, exempted vs inspected ratio, CPU vs inspection volume.
- **Advantages**: without it, every other UTM feature is partially blind on HTTPS — this is the multiplier that makes IPS/AV/Web Filter actually effective.

## 2.5 FortiGate Grafana Dashboards (no FortiAnalyzer)

- **HA Cluster Health** — HA mode, sync status, failover count last 24 h, last failover timestamp, primary vs secondary CPU/mem/sessions side‑by‑side. (SNMP)
- **Platform Performance** — CPU%, memory%, sessions vs licensed max, session setup rate, disk usage, conserve mode flag. (SNMP)
- **Interface Throughput** — separate row of panels for N/S and E/W interfaces: bps in/out, % of link, error/drop rate. (SNMP)
- **Routing & VPN** — BGP peer state matrix, route count trend, IPsec tunnel up/down matrix, SSL‑VPN active users. (SNMP + syslog event filter for BGP/IPsec down events)
- **UTM Security** — five tabs: **IPS**, **AntiVirus**, **App Control**, **Web Filter**, **DNS Filter**, each showing block rate, top names, top sources, geo map. All from Loki via syslog. (§2.4)
- **Admin & Compliance** — login attempts (success / failure), config‑change events with the admin user and source IP, time outside ITSM windows highlighted in red. (Loki)

> ✦ Use Grafana template variables `$node` (primary/secondary) and `$vdom` to switch views without duplicating dashboards.

## 2.6 Alerting from FortiGate (no FortiAnalyzer)

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
| VCN Ingress Throughput | VCN Flow Logs | Spike > 200% in 10 min | High | Possible ingress flood | OCI Monitoring + Grafana |
| VCN Egress Throughput | VCN Flow Logs | Spike > 200% in 10 min | High | Data exfil signal | OCI Monitoring + Grafana |
| Rejected Flow Count | VCN Flow Logs | > 1000/min on a subnet | High | NSG / Security List block surge | OCI Log Analytics |
| Top Rejected Source IPs | VCN Flow Logs | One IP > 500 denies/min | High | Scanning / brute force | OCI Log Analytics |
| LB Backend Health | OCI LB | Any backend unhealthy | Critical | Dropped traffic to dead backend | OCI Monitoring Alarms |
| LB 5xx Rate | OCI LB | > 2% | High | Origin application error | OCI Monitoring |
| LB Connection Refused | OCI LB | > 10/min | High | Backend pool exhausted | OCI Monitoring |
| Compute CPU (origin VMs) | OCI Compute | > 85% sustained | High | Origin overload | OCI Monitoring |
| Compute Memory (origin VMs) | OCI Compute | > 90% | High | OOM risk | OCI Monitoring (requires agent) |
| Block Volume IOPS | OCI Block Vol | > 80% provisioned | Medium | Storage bottleneck | OCI Monitoring |
| Block Volume Latency | OCI Block Vol | P99 > 5 ms | Medium | App latency impact | OCI Monitoring |
| DRG / FastConnect State | OCI Networking | Circuit down | Critical | On‑prem connectivity lost | OCI Monitoring |
| DRG Throughput | OCI Networking | > 80% capacity | High | On‑prem bandwidth saturation | OCI Monitoring |
| OCI Audit — IAM events | OCI Audit | Any unexpected privilege use | Critical | Compliance / security | OCI Audit → Loki/SIEM |
| Security List / NSG change | OCI Audit | Any change outside ITSM window | Critical | Unauthorized firewall change | OCI Audit |
| Object Storage 403 spike | OCI Object Storage | Spike in unauthorized | High | Data access anomaly | OCI Log Analytics |

## 3.2 VCN Flow Logs

- **How**: OCI Console → Logging → Log Groups → create group `vcn-flow-logs`. Networking → VCN → Subnets → enable Flow Logs (start with DMZ, management, inter‑service subnets; expand later for cost control). Recommended retention 30 days hot (90 for compliance).
- **Requirements**: IAM policy `allow service loggingsearch to read log-content in tenancy`, OCI Logging enabled, Service Connector Hub for export.
- **Advantages**: only OCI‑native way to see accepted / rejected packets between subnets and outbound to the internet without sidecar agents on every VM.

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

- **A — Service Connector Hub → Streaming (Kafka) → Loki** (recommended, real‑time)
- **B — Service Connector Hub → Object Storage → Logstash / Vector → Loki / Elasticsearch**
- **C — OCI Log Analytics native** + the OCI Log Analytics Grafana plugin

## 3.3 OCI Monitoring — Native Alarms

- LB: `HttpRequests`, `HttpResponses5xx`, `BackendTimeouts`, `UnhealthyBackendCount` (`oci_lbaas`)
- Compute: `CpuUtilization`, `MemoryUtilization` (`oci_computeagent`, requires Monitoring agent)
- Block Volume: `VolumeReadOps`, `VolumeWriteOps`, `VolumeReadThroughput`, `VolumeWriteThroughput` (`oci_blockstore`)
- DRG / FastConnect: `ConnectionState` (`oci_fastconnect`)
- Route alarms to OCI Notifications (email, Slack via HTTPS, PagerDuty) or OCI Functions for auto‑remediation.

## 3.4 OCI Audit Log — Security & Compliance

- Every API call in the tenancy is recorded.
- Forward to Loki (via Service Connector Hub → Streaming) or to your SIEM. Native retention is 90 days.
- Key events to alert on: `CreateVirtualNetwork`, `UpdateSecurityList`, `UpdateNetworkSecurityGroup`, `CreatePolicy`, `DeletePolicy`, `CreateUser`, `AddUserToGroup`, `UpdateUserCapabilities`.

## 3.5 OCI Grafana Dashboards

- **VCN Traffic** — ingress/egress bps per subnet, accept vs reject flow counts, top src/dst IPs, protocol mix.
- **Origin Health** — LB backend health map, LB 5xx rate, LB latency P50/P95, compute CPU/memory heatmap.
- **Security Deny Map** — rejected flows by source IP (Geomap), top denied destination ports, deny trend.
- **Infrastructure Ops** — block volume IOPS/latency, DRG circuit state, OCI service health.

---

# PART 4 — End‑to‑End Latency & Synthetic Monitoring

## 4.0 Path decomposition

- **Segment A** — Client → Cloudflare edge: DNS + TCP + TLS
- **Segment B** — Cloudflare → FortiGate (origin connect): `OriginResponseDurationMs`
- **Segment C** — FortiGate processing: inferred via correlated CPU and session latency
- **Segment D** — FortiGate → OCI LB: VCN internal hop (usually < 1 ms)
- **Segment E** — OCI LB → Origin VM: backend response time from OCI LB metric

## 4.1 Key Metrics

| Metric | Scope | Threshold | Severity | Tool |
|---|---|---|---|---|
| Full path latency P95 | CF → FG → Origin | > 3000 ms | Critical | Grafana synthetic / Blackbox |
| Full path latency P50 | CF → FG → Origin | > 800 ms | High | Grafana / CF Observatory |
| Synthetic HTTP UP/DOWN | External URL | Any DOWN | Critical | Blackbox / CF Health Checks |
| TLS validity | External URL | Cert < 14 d | High | Blackbox / cert‑manager |
| Hop‑by‑hop break | CF → FG → LB → VM | Any hop > 500 ms | High | CF Logpush + LB + Blackbox |
| DNS resolution time | DNS | P95 > 150 ms | Medium | Blackbox / CF DNS Analytics |
| TTFB (RUM) | CF → end user | P95 > 1500 ms | High | CF Browser Insights |
| Packet loss on path | Network | > 0.5% | High | MTR + ICMP Blackbox + OCI Network Path Analyzer |
| VPN tunnel latency | FG VPN | RTT > 150 ms | Medium | FG ping probes |
| FG internal processing delay | FG | CPU > 80% AND latency spike | High | Correlated rule |
| Origin response P95 | OCI LB / VM | > 1000 ms | High | OCI Monitoring |
| Availability SLO | E2E | < 99.9% | Critical | Grafana SLO panel |

## 4.2 Tooling

| Tool | Type | Role | Complexity |
|---|---|---|---|
| Prometheus Blackbox Exporter | OSS | HTTP / HTTPS / TCP / ICMP probes from OCI VM (and from an external VM) | Low |
| Grafana | OSS | Dashboards, alerts, SLO | Medium |
| Cloudflare Observatory / Speed | Native CF | Real‑user perf (TTFB, LCP) | None |
| Cloudflare Health Checks | Native CF | Active probe from CF edge → origin | Low |
| OCI Network Path Analyzer | Native OCI | Path trace between OCI resources | Low |
| OCI Monitoring alarms | Native OCI | Latency / health alarms | Low |
| MTR / traceroute cron | CLI | Scheduled hop probes from FG / OCI VM | Low |
| Cloudflare Logpush → Loki | CF + OSS | Real P50/P95 latency from real traffic | Medium |

## 4.3 Synthetic Probe Architecture

### Internal probes (OCI monitoring VM)

- HTTP to origin LB private IP → measures D + E
- ICMP to FortiGate inside interface → OCI‑internal packet loss
- TCP to FortiGate mgmt port → FG availability

### External probes (outside OCI to simulate client)

- HTTPS to public domain → full path A + B + C + D + E
- DNS probe to authoritative NS → DNS resolution time
- TLS expiry: warn 30 d, critical 14 d

### Cloudflare Health Checks

- Multi‑PoP probe from CF edge to origin
- Dashboard → Traffic → Health Checks → Create
- Interval 60 s, threshold = 2 consecutive failures
- Notification → email / PagerDuty

## 4.4 Latency Correlation Workflow

1. **Detect** — Grafana alert on full‑path P95.
2. **Isolate** — per‑segment dashboard: is CF edge latency normal? FG CPU spiking? LB backend time elevated?
3. **Confirm** — cross‑reference SNMP (FG CPU/sessions), VCN flow logs (drops), CF Logpush (`OriginResponseDurationMs`), OCI LB metrics.
4. **Resolve** — route to the right team: CF → CDN, FG → network ops, origin → app/infra.

## 4.5 SLO / Error Budget Dashboard

- SLO example: 99.9% of HTTP requests return 2xx within 2000 ms over 30 days.
- Error budget: 0.1% of requests ≈ 43 minutes of downtime / month.
- Grafana recording rules compute SLI (success ratio) and burn rate.
- Alert on fast burn (1‑h burn rate > 14× → page) and slow burn (6‑h burn rate > 6× → ticket).
- Panels: SLO compliance % (30 d), error budget remaining, burn rate chart, top error causes.

---

# Implementation Effort Summary

Effort assumes 1–2 engineers with experience in OCI, FortiGate, and Grafana. Numbers in engineer‑days.

| Part | Activity | Effort | Complexity | Dependencies | Deliverable |
|---|---|---|---|---|---|
| 1 | Cloudflare Logpush (`http_requests` + `firewall_events`) → Loki | 3–5 | Medium | CF Pro/Business/Ent plan that allows Logpush + needed datasets | Log pipeline + dashboards |
| 1 | Grafana CF plugin + DDoS / Firewall‑Events / Origin dashboards | 2–3 | Low‑Med | Logpush or API token | CF Grafana dashboards |
| 1 | Cloudflare Notifications + Grafana alert rules | 1–2 | Low | Dashboards live | Alert routing |
| 2 | FortiGate SNMP v3 + read‑only API user | 1–2 | Low | FW management access | SNMP / API live |
| 2 | Prometheus + SNMP Exporter (FortiGate generator) on OCI | 3–5 | Medium | OCI VM, Security List rules | Metrics pipeline |
| 2 | FortiGate Grafana dashboards (HA, perf, IF, VPN, BGP) | 4–6 | Medium | SNMP active | Core FG dashboards |
| 2 | Syslog → Promtail → Loki pipeline (replaces FortiAnalyzer) | 3–5 | Medium | Loki, FortiGate syslog config | Security log analytics |
| 2 | UTM dashboards: IPS / AV / AppCtrl / Web Filter / DNS Filter | 3–5 | Medium | Syslog pipeline + UTM profiles applied | UTM security dashboards |
| 2 | Alerting rules for UTM + admin/config‑change | 2–3 | Low‑Med | UTM dashboards | Alerts to Slack / PD |
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
| Part 1 — Cloudflare | 6–10 | Edge metrics + **blocked / bad‑packet visibility without WAF** in Grafana |
| Part 2 — FortiGate HA + UTM | 15–24 | Full FG observability incl. **IPS / AV / App‑Ctrl / Web Filter / DNS Filter** via syslog → Loki (no FortiAnalyzer) |
| Part 3 — OCI Origins | 7–10 | VCN flow logs, OCI alarms, LB/compute dashboards |
| Part 4 — E2E Latency | 8–11 | Synthetic probes, latency breakdown, SLO dashboard |
| Cross‑cutting | 6–10 | Tuned thresholds, runbooks, alert playbooks |
| **TOTAL** | **42–65 eng‑days** | Full observability across all 4 layers |

> ✦ Suggested phasing: Part 1 (CF) and Part 3 (OCI alarms + flow logs) in parallel as Phase 1 quick wins; Part 2 (FortiGate + UTM) and Part 4 (E2E) in Phase 2.

---

# Discussion Points for Manager Review

- **Part 1 — Cloudflare** — confirm plan tier; Logpush + `firewall_events` dataset is the gating capability for the “blocked / bad packets” visibility (it is what replaces the need for paid WAF analytics for this purpose).
- **Part 2 — FortiGate UTM** — confirm active FortiGuard subscriptions for **IPS, AntiVirus, Web/DNS Filtering, Application Control**; confirm scope of **SSL Inspection** (deep vs certificate, exemption list for compliance). Confirm syslog destination = our Loki/Promtail stack — **FortiAnalyzer is explicitly out of scope**.
- **Part 3 — OCI** — confirm IAM permissions for VCN Flow Logs + Service Connector Hub; choose retention (30 d hot / 90 d cold).
- **Part 4 — E2E** — agree on external probe location (separate cloud region or ISP‑hosted VM).
- **Alerting** — define on‑call rotation owner and select PagerDuty vs native OCI Notifications vs Slack‑only.
- **Baseline** — schedule a 1‑week baselining window before locking FG CPU / session / IPS rate thresholds.
