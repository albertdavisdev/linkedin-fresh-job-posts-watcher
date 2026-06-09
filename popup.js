const btn = document.getElementById("toggle");

async function render() {
  const data = await chrome.storage.local.get(["enabled"]);
  const enabled = data.enabled !== false;
  btn.textContent = enabled ? "Watcher ON" : "Watcher OFF";
  btn.className = enabled ? "on" : "off";
}

btn.addEventListener("click", async () => {
  const data = await chrome.storage.local.get(["enabled"]);
  const enabled = data.enabled !== false;
  await chrome.storage.local.set({ enabled: !enabled });
  render();
});

render();
