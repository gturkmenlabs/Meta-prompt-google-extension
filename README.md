# Meta-Prompt Motoru & Revizyon Sistemi 🚀

Bu proje, web sayfalarındaki metin kutularında (input/textarea) yer alan sıradan metinleri, Claude (Anthropic Messages API) veya OpenRouter entegrasyonu sayesinde **uzman düzeyinde prompt'lara (meta-prompt)** yerinde revize eden modern bir Google Chrome uzantısıdır (Manifest V3).

---

## ✨ Özellikler

- **Yerinde Revizyon (In-place Revision)**: Herhangi bir metin kutusundaki metni seçip kısayol tuşuna basarak metni doğrudan yerinde geliştirebilirsiniz.
- **Çoklu Sağlayıcı Desteği (Anthropic & OpenRouter)**: 
  - Doğrudan Anthropic Messages API (Claude Sonnet, Haiku, Opus vb.).
  - OpenRouter API aracılığıyla yüzlerce açık kaynaklı ve ticari model desteği.
- **Akıllı Hata Yönetimi ve Failover**: 
  - Bir model meşgul olduğunda veya hata verdiğinde, sıradaki alternatif modele otomatik geçiş (failover).
  - 401/403 gibi kritik yetkilendirme hatalarında gereksiz denemeleri durdurma.
- **Hızlı Kısayol Tanımı**:
  - `Ctrl + Shift + L` (Mac için `Cmd + Shift + L`) kısayolu ile anında revizyon.
- **Modern ve Kullanıcı Dostu Arayüz**: Ayarlar ve popup ekranlarında şık, modern ve duyarlı (responsive) tasarım.
- **Güvenli Depolama**: API anahtarlarınız ve model tercihleriniz tamamen yerel tarayıcı depolama alanında (`chrome.storage.local`) güvenle saklanır; üçüncü taraf sunuculara gönderilmez.

---

## 📂 Proje Yapısı

```text
├── manifest.json          # Chrome Uzantısı yapılandırma dosyası (V3)
├── background.js          # Arka plan işçisi (Service Worker), kısayol ve menü dinleyicileri
├── content.js             # Sayfalardaki metin alanlarına erişim sağlayan betik
├── api.js                 # Anthropic ve OpenRouter API entegrasyonları
├── config.js              # Sağlayıcı tanımları ve yerel ayar yönetim yardımcıları
├── popup.html / popup.js  # Hızlı erişim ve durum ekranı arayüzü
├── options.html / options.js # Detaylı model ve API anahtarı ayarları sayfası
├── prompt.js              # Revizyon sistem prompt'ları ve şablonları
├── brain_network.js       # Gelişmiş prompt optimizasyon ağı mantığı
├── brain_helper.js        # Yardımcı fonksiyonlar
├── verify_brain.js        # Doğrulama ve test aracı
├── compliance.md          # Uumluluk ve standartlar belgesi
├── methodology.md         # Prompt revizyon metodolojisi
└── performance_report.md  # Performans analiz raporu
```

---

## 🛠️ Kurulum ve Yükleme

Uzantıyı yerel olarak tarayıcınıza yüklemek için şu adımları izleyin:

1. Bu depoyu klonlayın veya indirin.
2. Google Chrome tarayıcınızı açın ve `chrome://extensions/` adresine gidin.
3. Sağ üst köşede bulunan **"Geliştirici modu" (Developer mode)** seçeneğini aktif hale getirin.
4. Sol üstteki **"Paketlenmemiş uzantı yükle" (Load unpacked)** butonuna tıklayın.
5. Bu projenin klasörünü (dosyaların bulunduğu ana dizini) seçerek yükleyin.

---

## ⚙️ Yapılandırma ve Kullanım

1. Tarayıcınızın uzantı barından **Meta-Prompt** simgesine tıklayın veya **Seçenekler (Options)** sayfasına gidin.
2. Tercih ettiğiniz sağlayıcıyı (Anthropic ya da OpenRouter) seçin.
3. API anahtarınızı (API Key) girin ve kullanmak istediğiniz modelleri yapılandırın.
4. Herhangi bir web sayfasındaki yazı alanına metninizi yazdıktan sonra:
   - Metni seçip sağ tıklayarak **"Meta-Prompt ile Revize Et"** seçeneğini seçebilir veya
   - `Ctrl + Shift + L` (`Cmd + Shift + L`) kısayolunu kullanabilirsiniz.
