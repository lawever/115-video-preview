// Service Worker
// 工具栏图标被点击时，向当前活动 tab 发送 toggle-panel 消息。
// content script 接到后切换浮窗显示。
// 如果 content script 还没注入（页面刚打开），会等几秒重试。

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  for (let i = 0; i < 10; i++) {
    try {
      await chrome.tabs.sendMessage(tab.id, { cmd: 'toggle-panel' });
      return;
    } catch (_) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
});