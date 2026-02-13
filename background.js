/**
 * Robusta Scheduler Helper - Background Service Worker
 * 
 * Bu service worker, extension'ın arka plan işlemlerini yönetir.
 * Şu an için minimal tutulmuştur, gelecekte genişletilebilir.
 */

// Extension yüklendiğinde
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Robusta Scheduler Helper extension yüklendi.');
  } else if (details.reason === 'update') {
    console.log('Robusta Scheduler Helper extension güncellendi.');
  }
});

// Storage temizleme - eski verileri temizle (5 dakikadan eski)
async function cleanupOldData() {
  try {
    const data = await chrome.storage.local.get('robustaFilterDates');
    if (data.robustaFilterDates) {
      const age = Date.now() - data.robustaFilterDates.timestamp;
      if (age > 300000) { // 5 dakika
        await chrome.storage.local.remove('robustaFilterDates');
        console.log('Eski filter verisi temizlendi.');
      }
    }
  } catch (error) {
    console.error('Storage temizleme hatası:', error);
  }
}

// Her 5 dakikada bir temizlik yap
chrome.alarms.create('cleanup', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cleanup') {
    cleanupOldData();
  }
});
