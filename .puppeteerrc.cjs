const {join} = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // ئەمە وادەکات چڕۆم لە ناو خودی پڕۆژەکەدا سەیڤ بێت نەک لە فۆڵدەری شاراوە
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
