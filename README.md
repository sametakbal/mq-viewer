# MQ Viewer

IBM MQ kuyruk mesajlarını görüntülemek ve bağlantı testi yapmak için geliştirilmiş masaüstü uygulaması.

## Özellikler

- **Bağlantı Testi** — IBM MQ Queue Manager'a bağlantı kontrolü
- **Mesaj Görüntüleme** — Kuyruktaki mesajları Browse modunda (non-destructive) okuma, kuyruktan mesaj silinmez
- **Mesaj Detayı** — Message ID, Correlation ID, Put Tarih, Format ve mesaj içeriğini görüntüleme
- **Bağlantı Kaydetme** — Bağlantı bilgilerini yerel olarak kaydetme, yükleme ve silme
- **Modern Arayüz** — FlatLaf temalı Swing arayüzü

## Gereksinimler

- Java 21+
- Maven 3.8+

## Kurulum ve Çalıştırma

```bash
# Projeyi klonla
git clone https://github.com/akbal/mq-viewer.git
cd mq-viewer

# Derle
mvn clean compile

# Çalıştır
mvn exec:java -Dexec.mainClass=org.akbal.Main

# Fat JAR oluştur
mvn clean package

# JAR ile çalıştır
java -jar target/mq-viewer-1.0-SNAPSHOT.jar
```

## Kullanım

1. **Bağlantı bilgilerini girin:**
   - Host, Port (varsayılan: 1414), Channel (varsayılan: DEV.ADMIN.SVRCONN)
   - Queue Manager adı, Queue Name
   - Kullanıcı adı ve şifre (opsiyonel)

2. **Bağlantı Testi** butonuna tıklayarak bağlantıyı doğrulayın.

3. **Mesajları Getir** butonuna tıklayarak kuyruktaki mesajları listeleyin.

4. Tablodan bir mesaj seçerek detaylarını ve içeriğini görüntüleyin.

5. Bağlantı bilgilerini **Kaydet** butonu ile saklayın, sonraki kullanımlarda **Yükle** ile geri getirin.

## Proje Yapısı

```
src/main/java/org/akbal/
├── Main.java                          # Uygulama giriş noktası
├── model/
│   ├── MqConnectionConfig.java        # Bağlantı ayarları modeli
│   └── MqMessage.java                 # Mesaj modeli
├── service/
│   ├── MqService.java                 # MQ bağlantı ve mesaj okuma servisi
│   └── ConnectionStore.java           # Bağlantı bilgilerini kaydetme servisi
└── ui/
    ├── MainFrame.java                 # Ana pencere
    ├── ConnectionPanel.java           # Bağlantı formu
    ├── MessageTablePanel.java         # Mesaj tablosu
    └── MessageDetailPanel.java        # Mesaj detay paneli
```

## Teknolojiler

| Teknoloji | Versiyon | Açıklama |
|-----------|----------|----------|
| Java | 21 | Platform |
| IBM MQ AllClient | 9.3.4.1 | MQ bağlantı kütüphanesi |
| FlatLaf | 3.4 | Modern Swing Look & Feel |
| Maven | 3.8+ | Build aracı |

## Notlar

- Mesajlar **Browse** modunda okunur, kuyruktan silinmez.
- Kayıtlı bağlantılar `~/.mq-viewer/connections.properties` dosyasında saklanır.
- Şifreler Base64 ile encode edilir (güvenli depolama değildir, hassas ortamlarda dikkatli olunmalıdır).

## Lisans

MIT
