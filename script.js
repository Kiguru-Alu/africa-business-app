/* app.js
   Africa Economy Hybrid Dashboard
   - Uses World Bank V2 (correct endpoints)
   - Indicator explorer + country profile
   - Handles pagination, timeouts, retries, null values
*/

const INDICATORS = [
    { code: "NY.GDP.MKTP.CD", label: "GDP (current US$)" },
    { code: "NY.GDP.MKTP.KD.ZG", label: "GDP growth (annual %)" },
    { code: "NY.GDP.PCAP.CD", label: "GDP per capita (current US$)" },
    { code: "SP.POP.TOTL", label: "Population (total)" },
    { code: "FP.CPI.TOTL.ZG", label: "Inflation, consumer prices (annual %)" },
    { code: "SL.UEM.TOTL.ZS", label: "Unemployment (% of labor force)" }
  ];
  
  const DOM = {
    indicatorSelect: document.getElementById("indicatorSelect"),
    countrySelect: document.getElementById("countrySelect"),
    searchBox: document.getElementById("searchBox"),
    regionFilter: document.getElementById("regionFilter"),
    sortSelect: document.getElementById("sortSelect"),
    yearFilter: document.getElementById("yearFilter"),
    loader: document.getElementById("loader"),
    error: document.getElementById("error"),
    tableBody: document.getElementById("tableBody"),
    profile: document.getElementById("profile"),
    profileName: document.getElementById("profileName"),
    profileMeta: document.getElementById("profileMeta"),
    profileIndicators: document.getElementById("profileIndicators"),
    trendChartEl: document.getElementById("trendChart"),
    closeProfile: document.getElementById("closeProfile")
  };
  
  let countries = [];        // all countries
  let africaCountries = [];  // those with region containing 'Africa'
  let tableData = [];        // latest non-null per country for active indicator
  let trendChart = null;
  
  const REQUEST_TIMEOUT = 12000; // ms
  const RETRIES = 2;
  
  // helper: fetch with timeout and simple retry
  async function fetchJson(url, timeout = REQUEST_TIMEOUT, retries = RETRIES) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const json = await res.json();
        return json;
      } catch (err) {
        clearTimeout(id);
        if (attempt === retries) throw err;
        // small backoff
        await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
      }
    }
  }
  
  // initialize UI & data
  (async function init() {
    try {
      populateIndicatorSelect();
      DOM.loader.style.display = "block";
      await loadCountries();
      populateCountrySelect();
      // load default indicator
      DOM.indicatorSelect.value = INDICATORS[0].code;
      await loadIndicatorForAll(INDICATORS[0].code);
      addListeners();
      DOM.loader.style.display = "none";
    } catch (err) {
      showError("Initialization error: " + (err.message || err));
    }
  })();
  
  // populate indicator dropdown
  function populateIndicatorSelect() {
    INDICATORS.forEach(i => {
      const opt = document.createElement("option");
      opt.value = i.code; opt.textContent = i.label;
      DOM.indicatorSelect.appendChild(opt);
    });
  }
  
  // load countries and filter to Africa
  async function loadCountries() {
    const url = "https://api.worldbank.org/v2/country?format=json&per_page=400";
    const json = await fetchJson(url);
    const list = Array.isArray(json) && json[1] ? json[1] : [];
    countries = list.map(c => ({
      name: c.name,
      code: c.id,
      region: c.region && c.region.value ? c.region.value : "N/A",
      incomeLevel: c.incomeLevel && c.incomeLevel.value ? c.incomeLevel.value : "N/A"
    }));
    africaCountries = countries.filter(c => c.region && c.region.toLowerCase().includes("africa"));
  }
  
  // populate country select used by profile
  function populateCountrySelect() {
    // sort alpha
    const sorted = [...africaCountries].sort((a,b)=>a.name.localeCompare(b.name));
    DOM.countrySelect.innerHTML = "<option value=''>— select country —</option>";
    sorted.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.code; opt.textContent = c.name;
      DOM.countrySelect.appendChild(opt);
    });
  }
  
  // LOAD INDICATOR for all countries (efficient approach using /country/all/indicator/{code})
  // We fetch a date range (last 12 years) and then select latest non-null per country.
  async function loadIndicatorForAll(indicatorCode) {
    try {
      DOM.error.style.display = "none";
      DOM.loader.style.display = "block";
      DOM.loader.textContent = "Loading indicator data…";
  
      const currentYear = new Date().getFullYear();
      const from = currentYear - 12;
      // initial page fetch to get pagination info
      const base = `https://api.worldbank.org/v2/country/all/indicator/${indicatorCode}?format=json&date=${from}:${currentYear}&per_page=1000`;
      const firstJson = await fetchJson(base);
      if (!Array.isArray(firstJson)) throw new Error("Unexpected API response");
      const meta = firstJson[0] || {};
      const totalPages = meta.pages || 1;
  
      let records = [];
      if (firstJson[1]) records = records.concat(firstJson[1]);
      // fetch remaining pages if any
      const pagePromises = [];
      for (let p = 2; p <= totalPages; p++) {
        const url = base + `&page=${p}`;
        pagePromises.push(fetchJson(url).catch(e => null));
      }
      const extras = await Promise.all(pagePromises);
      extras.forEach(js => { if (js && js[1]) records = records.concat(js[1]); });
  
      // build map of countryCode -> list of records (sorted by year desc)
      const map = new Map();
      records.forEach(r => {
        const code = r.countryiso3code || r.country?.id;
        if (!code) return;
        if (!map.has(code)) map.set(code, []);
        map.get(code).push(r);
      });
  
      // for african countries, pick latest non-null
      tableData = africaCountries.map(c => {
        const list = map.get(c.code) || [];
        list.sort((a,b) => parseInt(b.date) - parseInt(a.date));
        const pick = list.find(x => x.value !== null && x.value !== undefined);
        return {
          name: c.name,
          code: c.code,
          region: c.region,
          year: pick ? pick.date : "N/A",
          value: pick ? pick.value : null
        };
      });
  
      renderTable(tableData);
    } catch (err) {
      showError("Failed to load indicator data: " + (err.message || err));
    } finally {
      DOM.loader.style.display = "none";
    }
  }
  
  // render table with search / filter / sort / year filter
  function renderTable(data) {
    DOM.tableBody.innerHTML = "";
    const q = DOM.searchBox.value.trim().toLowerCase();
    const region = DOM.regionFilter.value;
    const yearFilter = DOM.yearFilter.value;
    let filtered = data.filter(r => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (region && r.region !== region) return false;
      if (yearFilter && String(r.year) !== String(yearFilter)) return false;
      return true;
    });
  
    const sort = DOM.sortSelect.value;
    if (sort === "name_asc") filtered.sort((a,b)=>a.name.localeCompare(b.name));
    if (sort === "name_desc") filtered.sort((a,b)=>b.name.localeCompare(a.name));
    if (sort === "value_desc") filtered.sort((a,b)=> (b.value||-Infinity) - (a.value||-Infinity));
    if (sort === "value_asc") filtered.sort((a,b)=> (a.value||Infinity) - (b.value||Infinity));
  
    // if yearFilter is empty, optionally populate yearFilter options with years found (first time)
    if (!DOM._yearOptionsPopulated) {
      const years = new Set(data.map(d => d.year).filter(y => y !== "N/A"));
      const sortedYears = Array.from(years).sort((a,b)=>b-a);
      DOM.yearFilter.innerHTML = "<option value=''>Any year</option>" + sortedYears.map(y=>`<option value="${y}">${y}</option>`).join("");
      DOM._yearOptionsPopulated = true;
    }
  
    if (filtered.length === 0) {
      DOM.tableBody.innerHTML = `<tr><td colspan="4" class="muted">No results</td></tr>`;
      return;
    }
  
    for (const row of filtered) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(row.name)}</td>
        <td class="muted">${escapeHtml(row.region)}</td>
        <td class="numeric">${escapeHtml(String(row.year))}</td>
        <td class="numeric">${row.value !== null ? Number(row.value).toLocaleString() : "N/A"}</td>
      `;
      tr.addEventListener("click", () => openProfile(row.code, row.name));
      DOM.tableBody.appendChild(tr);
    }
  }
  
  // event handlers
  function addListeners() {
    DOM.indicatorSelect.addEventListener("change", async () => {
      await loadIndicatorForAll(DOM.indicatorSelect.value);
    });
    DOM.searchBox.addEventListener("input", () => renderTable(tableData));
    DOM.regionFilter.addEventListener("change", () => renderTable(tableData));
    DOM.sortSelect.addEventListener("change", () => renderTable(tableData));
    DOM.yearFilter.addEventListener("change", () => renderTable(tableData));
    DOM.countrySelect.addEventListener("change", async () => {
      const code = DOM.countrySelect.value;
      const name = DOM.countrySelect.options[DOM.countrySelect.selectedIndex]?.text || "";
      if (code) await openProfile(code, name);
    });
    DOM.closeProfile.addEventListener("click", closeProfile);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeProfile(); });
  }
  
  // open profile: draw trend (selected indicator) and fetch key indicators
  async function openProfile(countryCode, countryName) {
    DOM.profile.setAttribute("aria-hidden", "false");
    DOM.profileName.textContent = countryName;
    DOM.profileMeta.textContent = `ISO3: ${countryCode}`;
  
    // trend for selected indicator
    const indicator = DOM.indicatorSelect.value;
    const years = 10;
    await loadTrend(countryCode, indicator, years);
  
    // key indicators summary: fetch latest non-null for each
    const keys = [
      { code: "NY.GDP.MKTP.CD", label: "GDP (current US$)" },
      { code: "NY.GDP.MKTP.KD.ZG", label: "GDP growth (%)" },
      { code: "NY.GDP.PCAP.CD", label: "GDP per capita" },
      { code: "SP.POP.TOTL", label: "Population" },
      { code: "FP.CPI.TOTL.ZG", label: "Inflation (%)" }
    ];
    DOM.profileIndicators.innerHTML = `<li class="muted small">Loading indicators…</li>`;
    try {
      const promises = keys.map(k => fetchLatestForCountry(countryCode, k.code).then(v => ({ label: k.label, value: v })));
      const results = await Promise.all(promises);
      DOM.profileIndicators.innerHTML = "";
      results.forEach(r => {
        const li = document.createElement("li");
        li.innerHTML = `<strong>${escapeHtml(r.label)}:</strong> ${r.value !== null ? Number(r.value).toLocaleString() : "N/A"}`;
        DOM.profileIndicators.appendChild(li);
      });
    } catch (err) {
      DOM.profileIndicators.innerHTML = `<li class="error">Failed to load indicators</li>`;
    }
  }
  
  // close profile modal
  function closeProfile() {
    DOM.profile.setAttribute("aria-hidden", "true");
    if (trendChart) { trendChart.destroy(); trendChart = null; }
    DOM.countrySelect.value = "";
  }
  
  // fetch latest non-null value for one country & indicator (range last 12 years)
  async function fetchLatestForCountry(countryCode, indicatorCode) {
    try {
      const currentYear = new Date().getFullYear();
      const from = currentYear - 12;
      const url = `https://api.worldbank.org/v2/country/${countryCode}/indicator/${indicatorCode}?format=json&date=${from}:${currentYear}&per_page=60`;
      const json = await fetchJson(url);
      const list = Array.isArray(json) && json[1] ? json[1] : [];
      list.sort((a,b)=>parseInt(b.date)-parseInt(a.date));
      const pick = list.find(x => x.value !== null && x.value !== undefined);
      return pick ? pick.value : null;
    } catch (err) {
      return null;
    }
  }
  
  // load trend for a country & draw chart
  async function loadTrend(countryCode, indicatorCode, years = 10) {
    try {
      const end = new Date().getFullYear();
      const start = end - years + 1;
      const url = `https://api.worldbank.org/v2/country/${countryCode}/indicator/${indicatorCode}?format=json&date=${start}:${end}&per_page=60`;
      const json = await fetchJson(url);
      const records = Array.isArray(json) && json[1] ? json[1] : [];
      // map year->value
      const map = {};
      records.forEach(r => { map[r.date] = r.value; });
      const labels = [];
      const values = [];
      for (let y = start; y <= end; y++) {
        labels.push(String(y));
        const v = map[String(y)];
        values.push(v !== null && v !== undefined ? v : null);
      }
  
      if (trendChart) trendChart.destroy();
      const ctx = DOM.trendChartEl.getContext("2d");
      trendChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: INDICATORS.find(i=>i.code===indicatorCode)?.label || indicatorCode,
            data: values,
            spanGaps: true,
            tension: 0.25,
            borderColor: '#0b64d6',
            backgroundColor: 'rgba(11,100,214,0.06)',
            pointRadius: 3
          }]
        },
        options: {
          responsive:true,
          scales: {
            y: {
              ticks: { callback: v => v === null ? '' : Number(v).toLocaleString() }
            }
          }
        }
      });
  
    } catch (err) {
      console.error("Trend load failed", err);
    }
  }
  
  // simple HTML escape
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;");
  }
  
  // show error
  function showError(msg) {
    DOM.error.style.display = "block";
    DOM.error.textContent = msg;
    DOM.loader.style.display = "none";
  }
  