/* eslint-disable brace-style */
const {onRequest} = require("firebase-functions/v2/https");
const axios = require("axios");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger"); // v2'de loglama için
const {
  GoogleGenerativeAI,
} = require("@google/generative-ai");

const apiKey = "Gemini Api Key";
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  tools: [
    {
      functionDeclarations: [
        {
          name: "turkishTabooGame",
          description: "random turkish words and forbidden words decided by ai",
          parameters: {
            type: "object",
            properties: {
              turkishWord: {
                type: "string",
              },
              forbiddenWords: {
                type: "array",
                items: {
                  type: "string",
                },
              },
            },
            required: [
              "turkishWord",
              "forbiddenWords",
            ],
          },
        },
      ],
    },
  ],
  toolConfig: {functionCallingConfig: {mode: "ANY"}},
});

const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192,
  responseModalities: [
  ],
  responseMimeType: "text/plain",
};
/**
 *
 * @param {string} chatId - Grup ID'si, tekrarlanan kelimeleri önlemek için
 * @return {*}
 */
async function run(chatId) {
  // Check if we already have this word in Firestore
  const chatSession = model.startChat({
    generationConfig,
    history: [
      {
        role: "user",
        parts: [
          {
            text: "Generate a random Turkish word. The word must NOT always"+
              "come from the same category. " +
            "Choose words from diverse topics such as technology, emotions,"+
            " culture, history, biology, abstract concepts, geography,"+
             "philosophy, slang, and daily life. " +
            "The word should be neither too easy nor always extremely"+
             "difficult — mix the difficulty levels occasionally. " +
            "Avoid repetition of similar words or word types over time. " +
                  "After generating the word, provide a list of "+
                  "forbidden words that are semantically related to the "+
                  "generated word but are NOT allowed to be used while "+
                  "describing or explaining it in a Taboo game.\n" +
                  "Do not ask for topic or input — it's all up to you.\n" +
                  "Return the output in the following structure:\n\n" +
                  "turkishWord: The generated word.\n\n" +
                  "forbiddenWords: An array of forbidden words related to the "+
                  "meaning of the word, but not directly describing it.",
          },

        ],
      },
      {
        role: "model",
        parts: [
          // eslint-disable-next-line max-len
          {text: "```json\n{\n\"turkishWord\": \"gökkuşağı\",\n\"forbiddenWords\": [\"renkler\", \"yağmur\", \"ışık\", \"güneş\", \"atmosfer\"]\n}\n```"},
        ],
      },
    ],
  });
  const input = `"Generate a random Turkish word. The word can belong
   to any topic,
   including but not limited to nature, technology, emotions, culture,
    science, or 
   daily life. After generating the word, provide a list of forbidden words that
    should not be used when describing or explaining the generated word in the 
    context of a Taboo game. The forbidden words should be related 
    to the meaning
     of the generated word but should not directly describe the word itself.

The word and its forbidden words should not be too simple or easy to guess, 
but should cover a variety of topics to provide challenge. And it all up 
to you, you will not ask for it to the user

Return the output in the following structure:

turkishWord: The generated word.

forbiddenWords: An array of forbidden words related to the meaning of
 the word, but not directly describing it."`;
  const result = await chatSession.sendMessage(input);

  // Fonksiyon çağrısını al
  const functionCall = result.response.candidates[0].
      content.parts[0].functionCall;

  if (functionCall && functionCall.name === "turkishTabooGame") {
    // Fonksiyon argümanlarını al
    const args = functionCall.args;

    // turkishWord ve forbiddenWords değerlerini çıkart
    const turkishWord = args.turkishWord;
    const forbiddenWords = args.forbiddenWords;

    console.log("Türkçe Kelime:", turkishWord);
    console.log("Yasaklı Kelimeler:", forbiddenWords);

    // Firestore'da bu kelimeyi kontrol et (eğer chatId verilmişse)
    if (chatId) {
      const exists = await wordExistsInGroup(chatId, turkishWord);
      if (exists) {
        // Eğer kelime zaten kullanılmışsa, recursive çağrı yap
        console.log(`"${turkishWord}" kelimesi bu grupta ` +
        "daha önce kullanılmış, yeni kelime isteniyor...");
        return run(chatId);
      } else {
        // Kelime daha önce kullanılmamışsa, Firestore'a kaydet
        await saveWordToFirestore(chatId, turkishWord, forbiddenWords);
      }
    }

    // Bu değerleri daha sonra kodunuzda kullanabilirsiniz
    return {turkishWord, forbiddenWords};
  } else {
    console.log("Beklenen formatta bir yanıt alınamadı.");
    console.log("Alınan yanıt:", result.response.candidates[0].
        content.parts[0]);
    return null;
  }
}

/**
 * Firestore'da bir kelimenin belirli bir grupta daha önce kullanılıp
 * kullanılmadığını kontrol eder
 * @param {string} groupId - Grup ID
 * @param {string} word - Kontrol edilecek kelime
 * @return {Promise<boolean>} - Kelime daha önce kullanılmışsa true
 */
async function wordExistsInGroup(groupId, word) {
  try {
    // 'games' koleksiyonundaki grup dökümanını al
    const groupRef = admin.firestore().collection("games")
        .doc(groupId.toString());
    // 'words' alt koleksiyonunda kelimeyi ara
    const snapshot = await groupRef.collection("words")
        .where("word", "==", word.toLowerCase())
        .limit(1)
        .get();
    return !snapshot.empty;
  } catch (error) {
    logger.error("Firestore kelime kontrolü hatası:", error);
    return false; // Hata durumunda false döndür (tekrar olmaması için)
  }
}

/**
 * Üretilen kelimeyi Firestore'a kaydeder
 * @param {string} groupId - Grup ID
 * @param {string} word - Kaydedilecek kelime
 * @param {Array} forbiddenWords - Yasaklı kelimeler
 * @return {Promise<void>}
 */
async function saveWordToFirestore(groupId, word, forbiddenWords) {
  try {
    // 'games' koleksiyonundaki grup dökümanını al, yoksa oluştur
    const groupRef = admin.firestore().collection("games")
        .doc(groupId.toString());
    // 'words' alt koleksiyonuna kelimeyi ekle
    await groupRef.collection("words").add({
      word: word.toLowerCase(),
      forbiddenWords: forbiddenWords.map((w) => w.toLowerCase()),
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    logger.info(`"${word}" kelimesi ${groupId} grubu için` +
        " Firestore'a kaydedildi.");
  } catch (error) {
    logger.error("Firestore kelime kaydetme hatası:", error);
  }
}

run();

// Firebase Admin SDK'yı başlat
admin.initializeApp();

// Oyun durumunu saklamak için global değişkenler
let gameState = {
  isActive: false,
  players: [],
  currentPlayerIndex: 0,
  joinTimeout: null,
  joinChatId: null,
  scores: {}, // Her oyuncunun puanını tutacak
  currentWord: null, // Mevcut tabu kelimesi
  forbiddenWords: [], // Yasaklı kelimeler
  gamePhase: "waiting", // waiting, joining, playing
};

// HTTP isteğiyle tetiklenen ana fonksiyon
exports.oyunBotu = onRequest({secrets: ["TELEGRAM_TOKEN"]},
    async (req, res) => {
      // Secrets'dan Telegram token'ını al
      const telegramToken = process.env.TELEGRAM_TOKEN;

      if (!telegramToken) {
        logger.error("Telegram token bulunamadı! " +
        "Secret Manager'da TELEGRAM_TOKEN ayarlandığından emin olun.");
        res.status(500).send("Sunucu yapılandırma hatası.");
        return;
      }

      try {
        // Gelen istek bir mesaj mı yoksa callback_query mi kontrol et
        const update = req.body;
        const message = update.message;
        const callbackQuery = update.callback_query;
        const myChatMember = update.my_chat_member;
        const chatMember = update.chat_member;
        const channelPost = update.channel_post;
        const editedMessage = update.edited_message;
        const inlineQuery = update.inline_query;
        const chosenInlineResult = update.chosen_inline_result;
        const pollUpdate = update.poll;
        const pollAnswer = update.poll_answer;

        // Bot durumu güncelleme işlemleri (grup ekleme/çıkarma vb.)
        if (myChatMember) {
          logger.info("Bot grup durumu güncellendi:",
              JSON.stringify(myChatMember, null, 2));
          // Bu tür güncellemeler için OK yanıtı döndür
          res.status(200).send("ok");
          return;
        }

        // Diğer desteklenmeyen güncelleme türleri
        if (chatMember || channelPost || editedMessage || inlineQuery ||
            chosenInlineResult || pollUpdate || pollAnswer) {
          logger.info("Desteklenmeyen güncelleme türü:",
              JSON.stringify(update, null, 2));
          res.status(200).send("ok");
          return;
        }

        // Callback query işleme (buton tıklamaları)
        if (callbackQuery) {
          const data = callbackQuery.data || "";
          const queryId = callbackQuery.id;
          // Güvenlik kontrolü: from objesi kontrol et
          if (!callbackQuery.from) {
            logger.error("Callback query'de from objesi eksik:", callbackQuery);
            res.status(200).send("ok");
            return;
          }

          const userId = callbackQuery.from.id;

          // Güvenlik kontrolü: message objesi kontrol et
          if (!callbackQuery.message || !callbackQuery.message.chat) {
            logger.error("Callback query'de message veya chat objesi eksik:",
                callbackQuery);
            res.status(200).send("ok");
            return;
          }

          const chatId = callbackQuery.message.chat.id;

          // show_word_USERID_WORD formatındaki callback'leri işle
          if (data.startsWith("show_word_")) {
            const parts = data.split("_");

            // Format şöyle olmalı: show_word_USERID_WORD
            if (parts.length >= 3) {
              const targetUserId = parts[2];

              // Sadece hedeflenen kullanıcıya popup göster
              if (userId.toString() === targetUserId) {
                // Kelime ve yasaklı kelimeleri popup olarak göster
                let popupMessage = `🔐 *Anlatacağınız Kelime:*
                 ${gameState.currentWord}\n\n`;
                popupMessage += `⛔ *Yasaklı Kelimeler:*\n`;

                gameState.forbiddenWords.forEach((word, index) => {
                  popupMessage += `${index + 1}. ${word}\n`;
                });

                popupMessage += "\n📢 Bu kelimeleri kullanmadan t"+
                "abu kelimeyi anlatın!";

                // Popup mesajı sadece butona tıklayan anlatıcıya gönder
                const answerUrl = `https://api.telegram.org/bot${telegramToken}/answerCallbackQuery`;
                await axios.post(answerUrl, {
                  callback_query_id: queryId,
                  text: popupMessage,
                  show_alert: true,
                });

                logger.info("Anlatıcıya popup mesaj gönderildi",
                    {userId, targetUserId});
              } else {
                // Yetkisiz kullanıcı uyarısı
                const answerUrl = `https://api.telegram.org/bot${telegramToken}/answerCallbackQuery`;
                await axios.post(answerUrl, {
                  callback_query_id: queryId,
                  text: "Bu buton sadece mevcut anlatıcı tarafından "+
                  "kullanılabilir.",
                  show_alert: true,
                });

                logger.info("Yetkisiz buton kullanımı", {userId, targetUserId});
              }
            }

            res.status(200).send("ok");
            return;
          } else if (data.startsWith("change_word_")) {
            // change_word_USERID formatındaki callback'leri işle
            const parts = data.split("_");

            // Format şöyle olmalı: change_word_USERID
            if (parts.length >= 3) {
              const targetUserId = parts[2];

              // Sadece hedeflenen kullanıcı kelimeyi değiştirebilir
              if (userId.toString() === targetUserId) {
                // Kullanıcıya bilgi ver
                const answerUrl = `https://api.telegram.org/bot${telegramToken}/answerCallbackQuery`;
                await axios.post(answerUrl, {
                  callback_query_id: queryId,
                  text: "Yeni bir kelime hazırlanıyor...",
                });

                // Yeni kelime al
                await refreshWord(chatId, telegramToken);

                logger.info("Anlatıcı kelimeyi değiştirdi",
                    {userId, targetUserId});
              } else {
                // Yetkisiz kullanıcı uyarısı
                const answerUrl = `https://api.telegram.org/bot${telegramToken}/answerCallbackQuery`;
                await axios.post(answerUrl, {
                  callback_query_id: queryId,
                  text: "Bu buton sadece mevcut anlatıcı tarafından "+
                  "kullanılabilir.",
                  show_alert: true,
                });

                logger.info("Yetkisiz buton kullanımı", {userId, targetUserId});
              }
            }

            res.status(200).send("ok");
            return;
          } else if (data === "katiliyorum") {
            // Katılma butonu işleme
            if (gameState.isActive && chatId === gameState.joinChatId) {
              if (callbackQuery.from) {
                if (!gameState.players.find((p) => p && p.id === userId)) {
                  // Username veya first_name için güvenlik kontrolü
                  const username = callbackQuery.from.username ||
                      callbackQuery.from.first_name || "Oyuncu";

                  gameState.players.push(callbackQuery.from);
                  await sendMessage(chatId, `🧑‍💼 ${username} oyuna katıldı.`,
                      telegramToken);
                }
              } else {
                logger.error("Katılma butonunda from objesi eksik:",
                    callbackQuery);
              }
            }

            // Callback query'yi yanıtla (sadece onay)
            const answerUrl = `https://api.telegram.org/bot${telegramToken}/answerCallbackQuery`;
            await axios.post(answerUrl, {
              callback_query_id: queryId,
              text: "Oyuna katıldınız!",
            });

            res.status(200).send("ok");
            return;
          }
        }

        // Mesaj veya callback_query'den ilgili bilgileri al
        let text;
        let chatId;
        let user;

        if (message) {
          // Normal mesaj ise
          text = message.text;
          chatId = message.chat.id;
          user = message.from;
        } else if (callbackQuery) {
          // Callback query (button click) ise
          text = callbackQuery.data;
          chatId = callbackQuery.message.chat.id;
          user = callbackQuery.from;
        }

        if (!chatId || !user) {
          logger.warn("Geçersiz istek formatı (chatId veya user eksik).");
          logger.info("Gelen istek:", JSON.stringify(update, null, 2));
          res.status(400).send("Bad Request"); // Hatalı istek
          return;
        }

        // /oyun komutuyla oyun başlatılır
        if (text === "/oyun" && !gameState.isActive) {
          gameState.isActive = true;
          gameState.players = [];
          gameState.joinChatId = chatId;
          gameState.gamePhase = "joining";
          gameState.scores = {};

          await sendMessageWithInlineKeyboard(chatId,
              "🎮 Oyun başlatıldı! Katılmak için aşağıdaki 'Katılıyorum' "+
            "butonuna basın! (1 dakika süreniz var)",
              telegramToken,
          );

          // 1 dakika boyunca katılımı bekle
          gameState.joinTimeout = setTimeout(async () => {
            if (!gameState.isActive) return;

            if (gameState.players.length < 2) {
              await sendMessage(chatId, "❌ Yeterli oyuncu yok." +
                " Oyun iptal edildi.",
              telegramToken);
              resetGame();
            } else {
              const playerNames = gameState.players.map((p) => p.username ||
                p.first_name).join(", ");
              const narrator = gameState.players[0].username ||
                gameState.players[0].first_name;

              // Oyuncu başlangıç puanlarını 0 olarak ayarla
              gameState.players.forEach((player) => {
                gameState.scores[player.id] = 0;
              });

              gameState.gamePhase = "playing";

              await sendMessage(chatId, `✅ Katılanlar: ${playerNames}\n\n🎙️
               Anlatıcı: ${narrator}`, telegramToken);

              // Oyunu başlat
              await startGame(chatId, telegramToken);
            }
            gameState.joinTimeout = null; // Timeout'u temizle
          }, 1 * 60 * 1000); // 1 dakika
        }
        // Katılım butonuna tıklama kontrolü
        else if (gameState.isActive && chatId === gameState.joinChatId &&
           text === "katiliyorum") {
          if (!gameState.players.find((p) => p.id === user.id)) {
            gameState.players.push(user);
            await sendMessage(chatId, `🧑‍💼 ${user.username ||
                  user.first_name} oyuna katıldı.`, telegramToken);
          }
        } else if (text === "/iptal" && gameState.isActive &&
          gameState.joinChatId === chatId) {
          if (gameState.joinTimeout) {
            clearTimeout(gameState.joinTimeout); // Bekleyen timeout'u iptal et
          }
          await sendMessage(chatId, "❌ Oyun iptal edildi.", telegramToken);
          resetGame();
        }
        // Oyun sırasında normal mesajları kontrol et
        else if (gameState.isActive && gameState.gamePhase === "playing" &&
            chatId === gameState.joinChatId && text && !text.startsWith("/")) {
          // Şu anki konuşmacı mı kontrol et
          const currentPlayerIndex = gameState.currentPlayerIndex;
          const currentPlayer = gameState.players[currentPlayerIndex];

          if (!currentPlayer) {
            logger.error("Anlatıcı oyuncu tanımlı değil!",
                {currentPlayerIndex});
            await sendMessage(chatId,
                "⚠️ Oyun durumu hatalı. Yeni oyun başlatın.",
                telegramToken);
            resetGame();
            res.status(200).send("ok");
            return;
          }

          if (!user) {
            logger.error("Kullanıcı tanımlı değil!");
            res.status(200).send("ok");
            return;
          }

          if (user.id === currentPlayer.id) {
            // Mesajda yasaklı kelimeler var mı kontrol et
            const lowerText = text.toLowerCase();
            const usedForbiddenWords = gameState.forbiddenWords.filter((word) =>
              lowerText.includes(word.toLowerCase()));

            if (usedForbiddenWords.length > 0) {
              // Yasaklı kelime kullanıldı!
              // Puanı düşür
              gameState.scores[currentPlayer.id] -= 1;

              await sendMessage(chatId,
                  `🚫 @${currentPlayer.username || currentPlayer.first_name ||
                    "Anlatıcı"} 
                  yasaklı kelime kullandı:
                   *${usedForbiddenWords.join(", ")}*\n` +
                `➖ 1 puan ceza aldı!\n` +
                `📊 Yeni puanı: ${gameState.scores[currentPlayer.id]}`,
                  telegramToken);

              // Rastgele bir sonraki oyuncuya geç
              const nextPlayerIndex = getRandomPlayerIndex(
                  gameState.players.length, currentPlayerIndex);
              gameState.currentPlayerIndex = nextPlayerIndex;
              const nextPlayer = gameState.players[nextPlayerIndex];

              if (!nextPlayer) {
                logger.error("Sonraki oyuncu tanımlı değil!",
                    {nextPlayerIndex});
                await sendMessage(chatId,
                    "⚠️ Oyun durumu hatalı. Yeni oyun başlatın.",
                    telegramToken);
                resetGame();
                res.status(200).send("ok");
                return;
              }

              // Yeni tur başlat
              await sendMessage(chatId,
                  `➡️ Sıradaki oyuncu: @${nextPlayer.username ||
                   nextPlayer.first_name || "Oyuncu"}`,
                  telegramToken);

              // Yeni kelime getir
              await refreshWord(chatId, telegramToken);
            }
          } else {
            // Anlatıcı olmayan oyuncuların mesajlarını kontrol et (tahmin)
            // Doğru kelimeyi tahmin edip etmediğini kontrol et
            const lowerText = text.toLowerCase();
            const lowerCurrentWord = gameState.currentWord ?
                gameState.currentWord.toLowerCase() : "";

            if (lowerCurrentWord && lowerText.includes(lowerCurrentWord)) {
              // Doğru tahmin!
              // Tahmin eden ve anlatıcıya puan ver
              const guesserScore = gameState.scores[user.id] || 0;
              const narratorScore = gameState.scores[currentPlayer.id] || 0;

              gameState.scores[user.id] = guesserScore + 1;
              gameState.scores[currentPlayer.id] = narratorScore + 1;

              await sendMessage(chatId,
                  `🎉 @${user.username || user.first_name ||
                     "Oyuncu"} doğru tahmin etti! ` +
                `Kelime: *${gameState.currentWord}*\n\n` +
                `➕ Tahmin eden (@${user.username ||
                  user.first_name || "Oyuncu"}): 
                +1 puan\n` +
                `➕ Anlatıcı (@${currentPlayer.username ||
                currentPlayer.first_name || "Anlatıcı"}): +1 puan`,
                  telegramToken);

              // Tahmin eden oyuncuyu yeni anlatıcı yap
              const playerIndex = gameState.players.findIndex(
                  (p) => p && p.id === user.id);

              if (playerIndex >= 0) {
                gameState.currentPlayerIndex = playerIndex;
                const newNarrator =
                gameState.players[gameState.currentPlayerIndex];

                if (newNarrator) {
                  await sendMessage(chatId,
                      `➡️ Sıradaki anlatıcı: @${newNarrator.username ||
                       newNarrator.first_name || "Anlatıcı"}`,
                      telegramToken);
                } else {
                  // Eğer oyuncu bulunamazsa, rastgele bir sonraki oyuncuya geç
                  const nextPlayerIndex = getRandomPlayerIndex(
                      gameState.players.length, currentPlayerIndex);
                  gameState.currentPlayerIndex = nextPlayerIndex;
                  const randomPlayer = gameState.players[nextPlayerIndex];

                  await sendMessage(chatId,
                      `➡️ Sıradaki anlatıcı: @${randomPlayer.username ||
                       randomPlayer.first_name || "Anlatıcı"}`,
                      telegramToken);
                }

                // Yeni kelime getir
                await refreshWord(chatId, telegramToken);
              } else {
                logger.error("Tahmin eden oyuncu bulunamadı!",
                    {userId: user.id});

                // Anlatıcıyı değiştirmeden yeni kelime getir
                await sendMessage(chatId, "⚠️ Oyuncu listesinde bulunamadınız,"+
                    "anlatıcı değişmiyor.", telegramToken);
                await refreshWord(chatId, telegramToken);
              }
            }
          }
        }
        // Oyun komutu kontrolü
        else if (gameState.isActive && text && text.startsWith("/") &&
            chatId === gameState.joinChatId) {
          // Oyun sırasındaki komutları işle
          await handleGameCommands(text, user, chatId, telegramToken);
        }

        res.status(200).send("ok"); // Telegram'a isteğin alındığını bildir
      } catch (error) {
        logger.error("Fonksiyon işlenirken hata oluştu:", error);
        // Böylece Telegram tekrar tekrar aynı isteği göndermeye çalışmaz.

        // Hata mesajını göndermek için chat ID'yi bulma
        let chatId;
        if (req.body.message?.chat.id) {
          chatId = req.body.message.chat.id;
        } else if (req.body.callback_query?.message?.chat.id) {
          chatId = req.body.callback_query.message.chat.id;
        }

        if (chatId && telegramToken) {
          try {
            await sendMessage(chatId,
                "😔 Bir hata oluştu, lütfen tekrar deneyin.", telegramToken);
          } catch (sendError) {
            logger.error("Hata mesajı gönderilemedi:", sendError);
          }
        }
        res.status(200).send("ok"); // Yine de OK gönder
      }
    });

/**
 * Telegram'a mesaj gönderir.
 * @param {number|string} chatId - Mesajın gönderileceği sohbet ID'si.
 * @param {string} text - Gönderilecek mesaj metni.
 * @param {string} token - Kullanılacak Telegram Bot Token'ı.
 * @return {Promise<axios.AxiosResponse>} - Axios isteğinin sonucu.
 */
function sendMessage(chatId, text, token) {
  if (!token) {
    logger.error("sendMessage çağrıldı ancak token sağlanmadı!");
    return Promise.reject(new Error("Telegram token eksik."));
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  logger.info(`Mesaj gönderiliyor: ${url}`,
      {chatId: chatId, text: text}); // Loglama

  // Oyun aktif ve katılım aşamasındaysa "Katıl" butonunu ekle
  let replyMarkup = null;
  if (gameState.isActive && chatId === gameState.joinChatId) {
    replyMarkup = {
      inline_keyboard: [
        [{
          text: "Katılıyorum",
          callback_data: "katiliyorum",
        }],
      ],
    };
  }

  return axios.post(url, {
    chat_id: chatId,
    text: text,
    parse_mode: "Markdown", // İsteğe bağlı: Mesaj formatı
    reply_markup: replyMarkup, // Buton ekle (eğer varsa)
  }).catch((error) => {
    logger.error("Telegram API'ye mesaj gönderilemedi:",
        error.response?.data || error.message);
    throw error; // Hatayı yukarıya ilet
  });
}

/**
 * Telegram'a inline butonlu mesaj gönderir.
 * @param {number|string} chatId - Mesajın gönderileceği sohbet ID'si.
 * @param {string} text - Gönderilecek mesaj metni.
 * @param {string} token - Kullanılacak Telegram Bot Token'ı.
 * @return {Promise<axios.AxiosResponse>} - Axios isteğinin sonucu.
 */
function sendMessageWithInlineKeyboard(chatId, text, token) {
  if (!token) {
    logger.error("sendMessageWithInlineKeyboard çağrıldı ancak"+
         "token sağlanmadı!");
    return Promise.reject(new Error("Telegram token eksik."));
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const inlineKeyboard = {
    inline_keyboard: [
      [{
        text: "Katılıyorum",
        callback_data: "katiliyorum",
      }],
    ],
  };
  logger.info(`Inline mesaj gönderiliyor: ${url}`,
      {chatId: chatId, text: text}); // Loglama
  return axios.post(url, {
    chat_id: chatId,
    text: text,
    parse_mode: "Markdown",
    reply_markup: inlineKeyboard,
  }).catch((error) => {
    logger.error("Telegram API'ye inline mesaj gönderilemedi:",
        error.response?.data || error.message);
    throw error; // Hatayı yukarıya ilet
  });
}

/**
 * Oyun durumunu sıfırlar.
 */
function resetGame() {
  logger.info("Oyun durumu sıfırlanıyor.");
  if (gameState.joinTimeout) {
    clearTimeout(gameState.joinTimeout);
  }
  gameState = {
    isActive: false,
    players: [],
    currentPlayerIndex: 0,
    joinTimeout: null,
    joinChatId: null,
    scores: {},
    currentWord: null,
    forbiddenWords: [],
    gamePhase: "waiting",
  };
}

/**
 * Oyunu başlatır ve ilk talimatları gönderir.
 * @param {number|string} chatId - Sohbet ID
 * @param {string} token - Telegram token
 */
async function startGame(chatId, token) {
  try {
    // Oyun durumunu aktif oyun moduna getir
    gameState.isActive = true;
    gameState.currentPlayerIndex = 0;

    const narrator = gameState.players[0];
    const narratorName = narrator.username || narrator.first_name;

    // Gemini API'den tabu kelimesi al - chatId parametresini ekleyerek
    // kelime tekrarını önle
    const tabuData = await run(chatId);

    if (tabuData && tabuData.turkishWord) {
      // Kelimeyi ve yasaklı kelimeleri sakla
      gameState.currentWord = tabuData.turkishWord;
      gameState.forbiddenWords = tabuData.forbiddenWords;

      // Tüm oyunculara genel talimatlar
      await sendMessage(chatId,
          `🎲 Oyun başladı!\n\n📝 Anlatıcı (${narratorName})
           tabu kelimeyi anlatmaya başlayacak.\n` +
        `⚠️ Yasaklı kelimeleri kullanmak yasaktır!
         Kullanıldığında -1 puan alınır.`,
          token);

      // Anlatıcıya özel mesaj - farklı bir mesaj olarak gönder
      await sendNarratorMessage(chatId, narrator.id, tabuData.turkishWord,
          tabuData.forbiddenWords, token);
    } else {
      // API hatası durumunda yedek kelime kullan
      const words = ["elma", "kitap", "bilgisayar", "film", "müzik"];
      gameState.currentWord = words[Math.floor(Math.random() * words.length)];
      gameState.forbiddenWords = ["yemek", "ağaç", "meyve"];

      await sendMessage(chatId,
          `🎲 Oyun başladı!\n\n📝 Anlatıcı (${narratorName})
           tabu kelimeyi anlatmaya başlayacak.`,
          token);

      // Anlatıcıya özel mesaj - farklı bir mesaj olarak gönder
      await sendNarratorMessage(chatId, narrator.id, gameState.currentWord,
          gameState.forbiddenWords, token);
    }
  } catch (error) {
    logger.error("Oyun başlatma hatası:", error);
    await sendMessage(chatId, "😔 Oyun başlatılırken bir hata oluştu.", token);
    resetGame();
  }
}

/**
 * Anlatıcıya özel mesaj gönderir
 * @param {number|string} chatId - Sohbet ID
 * @param {number|string} narratorId - Anlatıcı ID
 * @param {string} word - Anlatılacak kelime
 * @param {string[]} forbiddenWords - Yasaklı kelimeler
 * @param {string} token - Telegram token
 */
async function sendNarratorMessage(chatId, narratorId, word,
    forbiddenWords, token) {
  try {
    // Anlatıcı için özel buton içeren bir mesaj gönder
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    // Anlatıcıya özel butonlar içeren bir mesaj
    const inlineKeyboard = {
      inline_keyboard: [
        [{
          text: "🔐 Gizli Kelimeyi Gör",
          callback_data: `show_word_${narratorId}_${word}`,
        }],
        [{
          text: "🔄 Kelimeyi Değiştir",
          callback_data: `change_word_${narratorId}`,
        }],
      ],
    };

    // Butonlu mesajı gönder
    await axios.post(url, {
      chat_id: chatId,
      text: "📝 Anlatıcı, kelimeyi ve yasaklı kelimeleri görmek veya " +
            "kelimeyi değiştirmek için butonlara tıklayabilirsiniz",
      reply_markup: inlineKeyboard,
    });

    // Yasaklı kelimeleri callback datası olarak sakla
    // Bu çok uzun olabileceği için global state'de saklayalım
    gameState.currentNarratorId = narratorId;
    gameState.currentWord = word;
    gameState.forbiddenWords = forbiddenWords;

    logger.info("Anlatıcıya özel butonlar gönderildi", {narratorId, word});
  } catch (error) {
    logger.error("Anlatıcıya buton gönderme hatası:", error);
  }
}

/**
 * Oyun komutlarını işler.
 * @param {string} command - Komut metni
 * @param {object} user - Komutu gönderen kullanıcı
 * @param {number|string} chatId - Sohbet ID
 * @param {string} token - Telegram token
 */
async function handleGameCommands(command, user, chatId, token) {
  const isNarrator = user.id === gameState.players[0].id;

  if (!isNarrator && command !== "/puan" && command !== "/bitir") {
    sendMessage(chatId,
        "❌ Sadece anlatıcı oyun komutlarını kullanabilir.", token);
    return;
  }

  switch (command) {
    case "/kelimever": {
      // Oyun aşaması kontrolü
      if (gameState.gamePhase !== "playing") {
        sendMessage(chatId, "❌ Oyun henüz başlamadı.", token);
        return;
      }

      // Sadece mevcut anlatıcı kelime isteyebilir
      if (user.id !== gameState.players[gameState.currentPlayerIndex].id) {
        sendMessage(chatId,
            "❌ Sadece sıradaki anlatıcı kelime isteyebilir.", token);
        return;
      }

      // Yeni kelime al
      await refreshWord(chatId, token);
      break;
    }
    case "/tur": {
      // Oyun aşaması kontrolü
      if (gameState.gamePhase !== "playing") {
        sendMessage(chatId, "❌ Oyun henüz başlamadı.", token);
        return;
      }

      // Bir sonraki oyuncuya geç (rastgele)
      const currentIndex = gameState.currentPlayerIndex;
      const nextIndex = getRandomPlayerIndex(gameState.players
          .length, currentIndex);
      gameState.currentPlayerIndex = nextIndex;

      const nextPlayer = gameState.players[nextIndex];
      sendMessage(chatId,
          `⏩ Sıradaki oyuncu: @${nextPlayer.username || nextPlayer.first_name}`,
          token);

      // Yeni kelime al
      await refreshWord(chatId, token);
      break;
    }
    case "/puan": {
      // Oyun aşaması kontrolü
      if (gameState.gamePhase !== "playing") {
        sendMessage(chatId, "❌ Oyun henüz başlamadı.", token);
        return;
      }

      // Puanları görüntüle
      let scoreMessage = "🎯 Puanlar:\n";
      gameState.players.forEach((player, index) => {
        const score = gameState.scores[player.id] || 0;
        scoreMessage += `${index + 1}. @${player.username ||
            player.first_name}: ${score}\n`;
      });

      sendMessage(chatId, scoreMessage, token);
      break;
    }
    case "/bitir": {
      // Oyunu bitir
      // Puanları göster ve kazananı duyur
      let finalScoreMessage = "🏁 Oyun sona erdi!\n\n📊 Son Puanlar:\n";

      // Puanları hesapla ve sırala
      const playerScores = gameState.players.map((player) => ({
        player: player,
        score: gameState.scores[player.id] || 0,
      }));

      // Puanlara göre sırala (yüksekten düşüğe)
      playerScores.sort((a, b) => b.score - a.score);

      // Puanları göster
      playerScores.forEach((item, index) => {
        finalScoreMessage += `${index + 1}. @${item.player.username ||
            item.player.first_name}: ${item.score}\n`;
      });

      // Kazananı duyur (eğer puanı sıfırın üzerindeyse)
      if (playerScores.length > 0 && playerScores[0].score > 0) {
        const winner = playerScores[0].player;
        finalScoreMessage += `\n🏆 Tebrikler @${winner.username ||
            winner.first_name}! Oyunu kazandın!`;
      } else {
        finalScoreMessage += "\n😔 Kimse puan kazanamadı. Bir dahaki sefere!";
      }

      sendMessage(chatId, finalScoreMessage, token);
      resetGame();
      break;
    }
    default: {
      sendMessage(chatId,
          "❓ Geçersiz komut. Komutlar: /kelimever, /tur, /puan, /bitir", token);
      break;
    }
  }
}


/**
 * Rastgele oyuncu indeksi döndürür, mevcut oyuncuyu hariç tutar.
 * @param {number} playerCount - Toplam oyuncu sayısı
 * @param {number} currentIndex - Mevcut oyuncu indeksi
 * @return {number} - Yeni oyuncu indeksi
 */
function getRandomPlayerIndex(playerCount, currentIndex) {
  if (playerCount <= 1) return 0;

  let newIndex;
  do {
    newIndex = Math.floor(Math.random() * playerCount);
  } while (newIndex === currentIndex);

  return newIndex;
}

/**
 * Yeni bir kelime alır ve anlatıcıya özel olarak gönderir.
 * @param {number|string} chatId - Sohbet ID
 * @param {string} token - Telegram token
 */
async function refreshWord(chatId, token) {
  try {
    // Mevcut anlatıcıyı al
    const currentPlayerIndex = gameState.currentPlayerIndex;
    const currentPlayer = gameState.players[currentPlayerIndex];

    // Yeni tabu kelimesi al - chatId parametresi ekleyerek kelime tekrarını önl
    const tabuData = await run(chatId);

    if (tabuData && tabuData.turkishWord) {
      // Kelimeyi ve yasaklı kelimeleri sakla
      gameState.currentWord = tabuData.turkishWord;
      gameState.forbiddenWords = tabuData.forbiddenWords;

      // Anlatıcıya özel olarak kelimeyi ve yasaklı kelimeleri gönder
      await sendNarratorMessage(chatId, currentPlayer.id,
          gameState.currentWord, gameState.forbiddenWords, token);
    } else {
      // API hatası durumunda yedek kelime kullan
      const words = ["elma", "kitap", "bilgisayar", "film", "müzik"];
      gameState.currentWord = words[Math.floor(Math.random() * words.length)];
      gameState.forbiddenWords = ["yemek", "ağaç", "meyve"];

      // Anlatıcıya özel olarak kelimeyi ve yasaklı kelimeleri gönder
      await sendNarratorMessage(chatId, currentPlayer.id,
          gameState.currentWord, gameState.forbiddenWords, token);
    }
  } catch (error) {
    logger.error("Kelime yenileme hatası:", error);
    // Hata durumunda basit bir kelime ver
    const words = ["elma", "kitap", "bilgisayar", "film", "müzik"];
    gameState.currentWord = words[Math.floor(Math.random() * words.length)];
    gameState.forbiddenWords = ["yemek", "ağaç", "meyve"];

    // Anlatıcıya özel olarak kelimeyi gönder
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    await sendNarratorMessage(chatId, currentPlayer.id,
        gameState.currentWord, gameState.forbiddenWords, token);
  }
}
