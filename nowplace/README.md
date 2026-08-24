# NowPlace — MVP

Protótipo funcional do NowPlace: câmera dupla, geolocalização "aqui e agora",
regra de visualização condicional (24h) e cards com drag-and-drop.

## Estrutura

```
nowplace/
├── index.html        → estrutura da página
├── css/
│   └── styles.css    → design tokens e estilos
├── js/
│   └── app.js         → toda a lógica (storage, câmera, geo, drag&drop)
└── README.md
```

## Como rodar

Este app usa `navigator.geolocation` e a câmera do dispositivo. A maioria dos
navegadores só libera essas APIs em um **contexto seguro** (HTTPS ou
`localhost`) — abrir o `index.html` direto com duplo clique (`file://`)
normalmente **não funciona** para geolocalização.

No VS Code, a forma mais simples é usar a extensão **Live Server**:

1. Instale a extensão "Live Server" (Ritwick Dey) no VS Code.
2. Clique com o botão direito em `index.html` → "Open with Live Server".
3. O navegador abre em `http://127.0.0.1:5500` (ou similar) — geolocation e
   câmera vão funcionar normalmente.

Alternativa sem extensão, pelo terminal:

```bash
cd nowplace
python3 -m http.server 5500
```

E acesse `http://localhost:5500`.

## Testando no celular

Para testar a câmera nativa de verdade (não só o seletor de arquivos do
desktop), acesse pelo navegador do celular. Se o servidor estiver rodando no
seu computador, use o IP da máquina na rede local (ex:
`http://192.168.0.10:5500`) — e lembre-se que sem HTTPS, alguns navegadores
mobile podem bloquear a geolocalização mesmo em rede local. Se isso
acontecer, o app não trava: ele publica o Now com "Localização não
disponível" e segue funcionando.

## Sobre o storage — leia antes de expandir o MVP

O app salva tudo em `localStorage` (chaves `nowplace:me` e
`nowplace:post:<id>`). Isso é suficiente para testar a regra das 24h sozinho,
mas **localStorage não é compartilhado entre usuários/dispositivos** — cada
navegador tem o seu.

Para um NowPlace de verdade, com feed compartilhado entre pessoas, troque as
funções `storeGet` / `storeSet` / `storeListKeys` no topo de `js/app.js` por
chamadas a um backend (Firebase, Supabase, ou uma API própria com banco de
dados). O resto do app — câmera dupla, captura de geolocalização, regra de
bloqueio, drag-and-drop — não precisa mudar.

## Sobre o reverse geocoding

A busca do nome do lugar usa a API pública do Nominatim (OpenStreetMap), que
não exige chave. Para produção, vale a pena revisar a
[política de uso do Nominatim](https://operations.osmfoundation.org/policies/nominatim/)
ou trocar por Google Places / Mapbox, que têm limites mais folgados para uso
comercial.

## Sobre a câmera

A câmera liga **dentro da própria página**, via `navigator.mediaDevices.getUserMedia`
— não abre o app de câmera do sistema. O navegador vai pedir permissão de
câmera na primeira vez; aceite para ver o preview ao vivo.

- No computador, normalmente só existe uma webcam, então os dois passos
  (ambiente e selfie) vão usar a mesma câmera — a etapa da selfie aparece
  espelhada, como um espelho normal.
- Se o seu notebook tiver mais de uma câmera, um botão 🔄 aparece no canto do
  preview para trocar entre elas.
- Se a permissão for negada (ou não houver câmera), o app não trava: mostra
  um aviso e oferece um botão para escolher a foto por um seletor de arquivo
  comum, como alternativa.
- **Isso só funciona em contexto seguro** (HTTPS ou `localhost`) — veja a
  seção "Como rodar" acima.

## Funcionalidades implementadas

- **Câmera dupla**: preview ao vivo da webcam via `getUserMedia`, com botão
  de disparo — captura sequencial do ambiente e depois da selfie, direto na
  página.
- **Aqui e agora**: `navigator.geolocation` captura lat/lon no momento da
  publicação; um `fetch` ao Nominatim converte isso em endereço legível.
- **Visualização condicional**: `localStorage` guarda `lastPostAt`; se
  passaram mais de 24h, o feed fica bloqueado atrás de uma tela de gate.
- **Drag-and-drop nos cards**: implementado com Pointer Events (funciona em
  mouse e touch) — arrastar a foto pequena sobre a grande troca qual delas é
  a principal.

Um botão "simular novo dia (reset)" no cabeçalho existe só para facilitar
teste da regra de bloqueio, sem esperar 24h de verdade — pode remover para
produção.
