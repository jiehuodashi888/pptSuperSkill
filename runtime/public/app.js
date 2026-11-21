const status = document.getElementById("status");
const refresh = document.getElementById("refresh");

async function api(path, options) {
  const response = await fetch(path, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Review request failed");
  return value;
}

function record(container, value) {
  const pre = document.createElement("pre");
  pre.textContent = value === null ? "No record available." : JSON.stringify(value, null, 2);
  container.replaceChildren(pre);
}

async function load() {
  refresh.disabled = true;
  status.className = "";
  status.textContent = "Loading local review records…";
  // Remove obsolete decision controls as soon as a refresh starts.
  document.getElementById("pending").replaceChildren();
  try {
    const [pending, evidence, routing, audit] = await Promise.all([
      api("/api/approvals/pending"), api("/api/evidence"), api("/api/routing"), api("/api/audit"),
    ]);
    document.getElementById("company").textContent = routing.companyId;
    record(document.getElementById("evidence"), evidence.items);
    record(document.getElementById("routing"), routing.record);
    record(document.getElementById("audit"), audit.record);
    const container = document.getElementById("pending");
    if (!pending.items.length) container.textContent = "No candidates awaiting a decision.";
    for (const item of pending.items) {
      const card = document.createElement("article");
      const heading = document.createElement("h3");
      heading.textContent = item.request.request_id;
      const details = document.createElement("div");
      record(details, item.request);
      const reason = document.createElement("input");
      reason.placeholder = "Optional rejection reason";
      reason.setAttribute("aria-label", `Rejection reason for ${item.request.request_id}`);
      const actions = document.createElement("div");
      for (const action of ["approve", "reject"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = action === "approve" ? "Approve candidate" : "Reject candidate";
        if (action === "reject") button.className = "secondary";
        button.addEventListener("click", async () => {
          for (const control of actions.children) control.disabled = true;
          try {
            await api("/api/approvals", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ companyId: item.companyId, request_id: item.request.request_id, request_hash: item.request_hash,
                decision: action === "reject" ? { action, reason: reason.value } : { action } }),
            });
            await load();
          } catch (error) {
            status.className = "error";
            status.textContent = `${error.message}. Refresh records before trying again.`;
          }
        });
        actions.append(button);
      }
      card.append(heading, details, reason, actions);
      container.append(card);
    }
    status.textContent = `${pending.items.length} pending candidate(s).`;
  } catch (error) {
    status.className = "error";
    status.textContent = error.message;
  } finally { refresh.disabled = false; }
}

refresh.addEventListener("click", load);
load();
