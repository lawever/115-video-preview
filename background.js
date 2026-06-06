// 让点工具栏图标直接打开 Side Panel。
// 不参与消息路由——Side Panel 与 Content Script 直接通信。
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
