# Robusta Panel Helper - Kısa Proje Özeti

## Kısa Demo

![Robusta Scheduler Helper Demo](docs/assets/presentation.gif)

## Bu proje ne yapar?
- Bu eklenti, Robusta Scheduler ekranındaki instance tablosundaki herhangi bir instance satırından tarih bilgisini alır.
- Tek tıkla ilgili filtreleri diğer sayfalara taşır.
- Şu sayfaları destekler:
  - `Processes`
  - `Screenshots`
- Hover butonu satırın solunda değil, sağ tarafında görünür.
- Hedef sayfa açılınca filtre alanlarını otomatik doldurur ve aramayı başlatır.

## Robusta RPA'da hangi açığı kapatır?
- Buradaki açık bir güvenlik açığı değil, kullanım açığıdır.
- Robusta RPA içinde kullanıcı, bir ekrandaki tarih aralığını diğer ekrana doğrudan taşıyamıyor.
- Bu yüzden kullanıcılar tarihi elle kopyalıyor ve tekrar yazıyor.
- Bu proje şu boşluğu kapatır:
  - **Ekranlar arası filtre aktarımı yokluğu**
  - **Manuel tarih girişinden doğan zaman kaybı ve hata riski**

## Kullanıcı açısından sonuç
- Daha az tıklama
- Daha az manuel giriş
- Daha az yanlış tarih filtresi
- Sorun inceleme süresinde hızlanma

## Teknik olarak kısa akış
1. Kullanıcı instance satırındaki hover menüyü açar.
2. `Processes` veya `Screenshots` seçeneğine tıklar.
3. Eklenti start/end tarihi alır ve geçici olarak saklar.
4. Yeni sekmede hedef sayfayı açar.
5. Filtreleri otomatik uygular.

## Not
- Aktarım verisi kısa süreli tutulur ve sonra temizlenir.
- Amaç kalıcı veri saklamak değil, tek seferlik filtre taşımasıdır.
- Paylaşılan GIF kayıtları hassas bilgi içermiyorsa GitHub'a yüklenebilir.