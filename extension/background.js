// Handle keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || (!tab.url.includes("x.com") && !tab.url.includes("twitter.com"))) return;

  if (command === "toggle-play") {
    chrome.tabs.sendMessage(tab.id, { action: "togglePlay" });
  } else if (command === "skip-tweet") {
    chrome.tabs.sendMessage(tab.id, { action: "skip" });
  }
});
