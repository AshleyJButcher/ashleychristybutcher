function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",");
  return lines.map((line) => {
    const cols = [];
    let cur = "";
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === "," && !inQuotes) {
        cols.push(cur);
        cur = "";
      } else cur += ch;
    }
    cols.push(cur);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] || "";
    });
    return row;
  });
}

function el(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

async function loadTimesheet() {
  const summary = document.getElementById("timesheet-summary");
  const body = document.querySelector("#timesheet-table tbody");
  try {
    const res = await fetch("june_2026_7pace_timesheet.csv");
    if (!res.ok) throw new Error("missing");
    const rows = parseCsv(await res.text());
    const hours = rows.reduce((sum, row) => sum + (Number(row.Hours) || 0), 0);
    summary.textContent = `${rows.length} entries · ${hours} hours`;
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.append(
        el("td", row.Date || "—"),
        el("td", row.Ticket || "—"),
        el("td", row.Title || "—"),
        el("td", row.Hours || "0")
      );
      body.append(tr);
    });
  } catch {
    summary.textContent = "Could not load the CSV. Open it from the download card instead.";
  }
}

async function loadWorkItems() {
  const summary = document.getElementById("workitems-summary");
  const body = document.querySelector("#workitems-table tbody");
  try {
    const res = await fetch("workitems.json");
    if (!res.ok) throw new Error("missing");
    const data = await res.json();
    const items = (data.value || []).map((item) => {
      const fields = item.fields || {};
      const iteration = String(fields["System.IterationPath"] || "");
      return {
        id: String(item.id || ""),
        title: String(fields["System.Title"] || ""),
        type: String(fields["System.WorkItemType"] || ""),
        state: String(fields["System.State"] || ""),
        iteration: iteration.split("\\").pop() || iteration,
      };
    });
    summary.textContent = `${items.length} items · titles and state only`;
    items.forEach((item) => {
      const tr = document.createElement("tr");
      tr.append(
        el("td", item.id),
        el("td", item.title),
        el("td", item.type),
        el("td", item.state),
        el("td", item.iteration)
      );
      body.append(tr);
    });
  } catch {
    summary.textContent = "Could not load the JSON. Open it from the download card instead.";
  }
}

loadTimesheet();
loadWorkItems();
