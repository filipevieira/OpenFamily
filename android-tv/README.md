# OpenFamily Android TV / Google TV App

Aplicativo nativo WebView open-source otimizado para **Android TV**, **Google TV** e **Smart TVs com Android**.

---

## 📺 Recursos

- **Suporte Nativo a Android TV Leanback**: O ícone aparece diretamente no menu principal de apps e canais da sua TV.
- **Modo Imersivo (Fullscreen)**: Sem barras de navegação, sem campo de URL e sem atalhos de navegador.
- **Mantém a Tela Acesa (Keep Screen On)**: Perfeito para exibir o painel da família na sala ou cozinha.
- **Acelerador Gráfico Habilitado**: Transição suave de fotos e recados.

---

## 🚀 Como Gerar o Arquivo `.apk`

### Opção 1: Compilar usando o Android Studio
1. Abra a pasta `android-tv` no **Android Studio**.
2. Aguarde a sincronização do Gradle.
3. Clique no menu **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
4. O arquivo gerado estará em: `app/build/outputs/apk/debug/app-debug.apk`.

### Opção 2: Compilar via Linha de Comando (Gradle)
```bash
cd android-tv
./gradlew assembleRelease
```

---

## 📲 Como Instalar na TV (Sideloading)

1. Envie o arquivo `.apk` para a TV usando o app gratuito **Send Files to TV** (disponível na Google Play Store da TV e do Celular).
2. Abra o gerenciador de arquivos da TV (ex: *AnExplorer* ou *File Commander*) e instale o `.apk`.
3. Na 1ª inicialização, insira a URL do seu servidor OpenFamily (ex: `https://familia.fvds.dev/kiosk?token=SEU_TOKEN`).
