// js/algorithms.js
// ---------------------------------------------------------------------------
// AlgorithmManager — bộ khung trung tâm quản lý các thuật toán mật mã.
//
// Trách nhiệm:
//   - Đăng ký (register) thuật toán và metadata liên quan.
//   - Sinh danh sách các bước trực quan hóa (generateSteps) cho AnimationController.
//   - Trả về nội dung giải thích (getExplanation) cho panel "Giải thích".
//   - Thực thi (run) một thuật toán đã đăng ký, ghi log qua Logger và
//     đồng bộ tổng số bước với AnimationController.
//
// LƯU Ý: File này KHÔNG chứa logic mã hóa/giải mã/băm thật. Mỗi thuật toán chỉ
// được đăng ký với metadata (nhãn, có cần khóa hay không, gợi ý khóa, giải
// thích). Các hàm `generateSteps` và `execute` sẽ được cung cấp ở các bước
// triển khai tiếp theo, cho từng thuật toán riêng biệt.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} AlgorithmDefinition
 * @property {string} label - Tên hiển thị của thuật toán.
 * @property {boolean} [requiresKey] - Thuật toán có cần khóa/tham số phụ hay không.
 * @property {string} [keyHint] - Gợi ý hiển thị cho ô nhập khóa.
 * @property {string} [explanation] - Nội dung giải thích nguyên lý hoạt động.
 * @property {boolean} [decodable] - Thuật toán có hỗ trợ chế độ "Giải mã" thật sự trong ứng dụng
 *   này hay không (mặc định false). Chỉ true cho các thuật toán có phép nghịch đảo đã triển khai
 *   (XOR, Hill Cipher, Base64) — dùng để ẩn/hiện nút "Giải mã" trên giao diện.
 * @property {number} [exactKeyLength] - Nếu có, khóa PHẢI có đúng số ký tự (chữ cái) này — dùng
 *   cho Hill Cipher (khóa phải đúng 4 chữ cái cho ma trận 2x2). Dùng để giới hạn maxlength của ô
 *   nhập khóa và validate trước khi chạy (báo lỗi qua alert() thay vì toast).
 * @property {(ctx: {mode: string, input: string, key: string}) => Array} [generateSteps]
 *   Hàm sinh danh sách các bước trực quan hóa. Chưa được triển khai cho các
 *   thuật toán hiện tại.
 * @property {(ctx: {mode: string, input: string, key: string, steps: Array}) => string} [execute]
 *   Hàm thực thi thật (mã hóa/giải mã/băm) và trả về kết quả dạng chuỗi.
 *   Chưa được triển khai cho các thuật toán hiện tại.
 */

export class AlgorithmManager {
  #registry = new Map();
  #logger = null;
  #animation = null;

  /**
   * @param {Object} [deps]
   * @param {import('./logger.js').Logger} [deps.logger]
   * @param {import('./animation.js').AnimationController} [deps.animation]
   */
  constructor({ logger = null, animation = null } = {}) {
    this.#logger = logger;
    this.#animation = animation;
  }

  /** Gắn (hoặc thay thế) Logger sau khi khởi tạo. */
  attachLogger(logger) {
    this.#logger = logger;
    return this;
  }

  /** Gắn (hoặc thay thế) AnimationController sau khi khởi tạo. */
  attachAnimation(animation) {
    this.#animation = animation;
    return this;
  }

  /**
   * Đăng ký một thuật toán mới vào registry.
   * @param {string} id - Định danh duy nhất (vd: "caesar").
   * @param {AlgorithmDefinition} definition
   * @returns {AlgorithmDefinition} entry đã được chuẩn hóa.
   */
  register(id, definition) {
    if (!id || typeof id !== 'string') {
      throw new Error('AlgorithmManager.register: id thuật toán không hợp lệ.');
    }
    if (!definition || typeof definition !== 'object') {
      throw new Error(`AlgorithmManager.register: định nghĩa thuật toán "${id}" không hợp lệ.`);
    }

    const entry = {
      id,
      label: definition.label ?? id,
      requiresKey: Boolean(definition.requiresKey),
      keyHint: definition.keyHint ?? '',
      explanation: definition.explanation ?? 'Chưa có giải thích cho thuật toán này.',
      decodable: Boolean(definition.decodable),
      exactKeyLength: Number.isInteger(definition.exactKeyLength) ? definition.exactKeyLength : null,
      generateSteps: typeof definition.generateSteps === 'function' ? definition.generateSteps : null,
      execute: typeof definition.execute === 'function' ? definition.execute : null,
    };

    this.#registry.set(id, entry);
    return entry;
  }

  /** Hủy đăng ký một thuật toán. */
  unregister(id) {
    return this.#registry.delete(id);
  }

  /** Kiểm tra thuật toán đã được đăng ký chưa. */
  has(id) {
    return this.#registry.has(id);
  }

  /** Trả về danh sách metadata (không lộ hàm nội bộ) của tất cả thuật toán đã đăng ký. */
  list() {
    return Array.from(this.#registry.values()).map((entry) => this.#toPublicMeta(entry));
  }

  /** Trả về metadata của một thuật toán, hoặc null nếu không tồn tại. */
  get(id) {
    const entry = this.#registry.get(id);
    return entry ? this.#toPublicMeta(entry) : null;
  }

  /** Trả về nội dung giải thích của thuật toán (dùng cho panel "Giải thích"). */
  getExplanation(id) {
    const entry = this.#registry.get(id);
    return entry ? entry.explanation : 'Không tìm thấy thuật toán được yêu cầu.';
  }

  /** Thuật toán có yêu cầu khóa/tham số phụ hay không. */
  requiresKey(id) {
    const entry = this.#registry.get(id);
    return entry ? entry.requiresKey : false;
  }

  /** Gợi ý hiển thị cho ô nhập khóa của thuật toán. */
  getKeyHint(id) {
    const entry = this.#registry.get(id);
    return entry ? entry.keyHint : '';
  }

  /**
   * Sinh danh sách các bước trực quan hóa cho một thuật toán, KHÔNG ghi log
   * và KHÔNG đụng tới AnimationController (dùng khi chỉ cần xem trước các bước).
   * @throws nếu thuật toán chưa được đăng ký hoặc chưa có generateSteps.
   */
  generateSteps(id, { mode = 'encrypt', input = '', key = '' } = {}) {
    const entry = this.#requireEntry(id);
    if (!entry.generateSteps) {
      throw new Error(`AlgorithmManager: thuật toán "${entry.label}" chưa được triển khai (chưa có generateSteps).`);
    }
    const steps = entry.generateSteps({ mode, input, key });
    if (!Array.isArray(steps)) {
      throw new Error(`AlgorithmManager: generateSteps của "${entry.label}" phải trả về một mảng.`);
    }
    return steps;
  }

  /**
   * Thực thi đầy đủ một thuật toán đã đăng ký:
   *   1. Kiểm tra tồn tại + validate khóa nếu cần.
   *   2. Sinh danh sách bước qua generateSteps.
   *   3. Ghi từng bước vào Logger (logStep).
   *   4. Đồng bộ tổng số bước với AnimationController (setTotalSteps).
   *   5. Gọi execute để lấy kết quả cuối cùng.
   *
   * @param {string} id - Định danh thuật toán.
   * @param {{mode?: 'encrypt'|'decrypt', input?: string, key?: string}} options
   * @returns {Promise<{steps: Array, result: string}>}
   */
  async run(id, { mode = 'encrypt', input = '', key = '' } = {}) {
    const entry = this.#requireEntry(id, { logOnError: true });
    const actionLabel = mode === 'decrypt' ? 'giải mã' : 'mã hóa';

    if (entry.requiresKey && !key) {
      const message = `Thuật toán "${entry.label}" yêu cầu khóa/tham số nhưng không được cung cấp.`;
      this.#log(`Lỗi: ${message}`);
      throw new Error(message);
    }

    if (!entry.generateSteps || !entry.execute) {
      const message = `Thuật toán "${entry.label}" chưa được triển khai logic ${actionLabel}.`;
      this.#log(`Lỗi: ${message}`);
      throw new Error(message);
    }

    this.#log(`Bắt đầu ${actionLabel} với thuật toán "${entry.label}".`);

    const steps = entry.generateSteps({ mode, input, key });
    if (!Array.isArray(steps) || steps.length === 0) {
      const message = `Thuật toán "${entry.label}" không sinh ra bước trực quan hóa nào.`;
      this.#log(`Lỗi: ${message}`);
      throw new Error(message);
    }

    steps.forEach((step) => {
      const text = typeof step === 'string' ? step : step?.description ?? '';
      if (text) this.#log(text, { asStep: true });
    });

    if (this.#animation && typeof this.#animation.setTotalSteps === 'function') {
      this.#animation.setTotalSteps(steps.length);
    }

    // `await` here works whether execute() is sync (bitwise ops, MD5) or
    // returns a Promise (SHA-256 via Web Crypto's crypto.subtle.digest).
    const result = await entry.execute({ mode, input, key, steps });

    this.#log(`Hoàn tất ${actionLabel} với thuật toán "${entry.label}".`);

    return { steps, result };
  }

  // -- Nội bộ ----------------------------------------------------------------

  #requireEntry(id, { logOnError = false } = {}) {
    const entry = this.#registry.get(id);
    if (!entry) {
      if (logOnError) this.#log(`Lỗi: không tìm thấy thuật toán "${id}".`);
      throw new Error(`AlgorithmManager: không tìm thấy thuật toán "${id}".`);
    }
    return entry;
  }

  #toPublicMeta(entry) {
    const { generateSteps, execute, ...meta } = entry;
    return { ...meta, isImplemented: Boolean(generateSteps && execute) };
  }

  #log(message, { asStep = false } = {}) {
    if (!this.#logger) return;
    if (asStep && typeof this.#logger.logStep === 'function') {
      this.#logger.logStep(message);
    } else if (typeof this.#logger.log === 'function') {
      this.#logger.log(message);
    }
  }
}

// ---------------------------------------------------------------------------
// Instance mặc định + đăng ký metadata cho 6 thuật toán hiện có trong giao diện.
// CHƯA có generateSteps / execute — sẽ được bổ sung ở các nhiệm vụ tiếp theo.
// ---------------------------------------------------------------------------

export const algorithmManager = new AlgorithmManager();

algorithmManager.register('caesar', {
  label: 'Caesar Cipher',
  requiresKey: true,
  keyHint: 'Nhập một số nguyên làm độ dịch chuyển (vd: 3).',
  explanation:
    'Caesar Cipher là một trong những phương pháp mã hóa cổ điển nhất, dịch chuyển mỗi ký tự trong bảng chữ cái đi một số vị trí cố định. Đây là dạng đơn giản của mã hóa thay thế (substitution cipher), dễ bị phá vỡ bằng phân tích tần suất.',
});

algorithmManager.register('vigenere', {
  label: 'Vigenère Cipher',
  requiresKey: true,
  keyHint: 'Nhập một chuỗi ký tự làm từ khóa (vd: KEY).',
  explanation:
    'Vigenère Cipher sử dụng một từ khóa lặp lại để mã hóa văn bản bằng nhiều bảng Caesar khác nhau, giúp chống lại phân tích tần suất đơn giản hơn so với Caesar Cipher. Đây là một dạng mã hóa đa bảng (polyalphabetic substitution).',
});

algorithmManager.register('aes', {
  label: 'AES',
  requiresKey: true,
  keyHint: 'Nhập khóa bí mật (độ dài tùy phiên bản AES).',
  explanation:
    'AES (Advanced Encryption Standard) là thuật toán mã hóa khối đối xứng hiện đại, xử lý dữ liệu theo từng khối 128-bit qua nhiều vòng biến đổi (SubBytes, ShiftRows, MixColumns, AddRoundKey). Đây là chuẩn mã hóa được sử dụng rộng rãi nhất hiện nay.',
});

algorithmManager.register('rsa', {
  label: 'RSA',
  requiresKey: true,
  keyHint: 'Nhập tham số khóa công khai/riêng tư liên quan.',
  explanation:
    'RSA là thuật toán mã hóa khóa công khai dựa trên độ khó của bài toán phân tích thừa số nguyên tố lớn. Mỗi bên có một cặp khóa: khóa công khai để mã hóa và khóa riêng tư để giải mã.',
});

// Lưu ý: 'base64' được đăng ký đầy đủ (generateSteps + execute) ở cuối file,
// ngay sau phần SHA-256 — xem khối "BASE64 — Trình minh họa giáo dục".

// ---------------------------------------------------------------------------
// Phép toán Bit XOR — Text vs Text
//
// So sánh hai văn bản (A = văn bản đầu vào chính, B = văn bản thứ hai nhập ở
// ô "khóa/tham số") theo từng ký tự: ASCII → Nhị phân 8-bit → So sánh từng
// bit → Byte kết quả. Nếu hai văn bản không cùng độ dài, ký tự thiếu được
// coi như mã ASCII 0 (NUL) và một bước cảnh báo được chèn vào đầu danh sách
// bước.
//
// CHỈ giữ lại XOR — AND và OR đã bị loại bỏ vì chúng KHÔNG khả nghịch: biết
// kết quả AND(a,b) hoặc OR(a,b) và một trong hai toán hạng không đủ để suy
// ngược ra toán hạng còn lại một cách chắc chắn (thông tin bị mất ở những
// bit mà cả hai đầu vào giống nhau). XOR thì khác — nó tự nghịch đảo
// (A XOR B XOR B = A), nên cùng một phép toán XOR áp dụng lại là "giải mã".
// ---------------------------------------------------------------------------

const BIT_OPS = Object.freeze({
  xor: { label: 'XOR', fn: (a, b) => a ^ b, isActive: (a, b) => a !== b },
});

/** Lấy mã ASCII (0–255) của ký tự tại vị trí index; trả 0 nếu vượt quá độ dài chuỗi. */
function charCodeSafe(text, index) {
  return index < text.length ? text.charCodeAt(index) & 0xff : 0;
}

/** Chuyển một mã ASCII (0–255) thành chuỗi nhị phân 8-bit, có đệm số 0 phía trước. */
function toBinary8(code) {
  return code.toString(2).padStart(8, '0');
}

/** Chuyển một giá trị 0–63 thành chuỗi nhị phân 6-bit, có đệm số 0 phía trước. */
function toBinary6(value) {
  return value.toString(2).padStart(6, '0');
}

/**
 * Parse a hex-byte string like "1F 0A 1E 00 0B" or "1F0A1E000B" (any/no
 * whitespace between byte pairs) into an array of byte values (0–255).
 * This is the exact format formatBitwiseResult() prints for the encoded
 * ciphertext, so it's what a user pastes back in to decode.
 * @throws nếu chuỗi không phải hex hợp lệ hoặc có số ký tự lẻ.
 */
function parseHexBytes(hexText) {
  const cleaned = (hexText ?? '').trim().replace(/\s+/g, '');
  if (cleaned.length === 0) return [];
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new Error(
      'Đầu vào để giải mã phải là chuỗi hex hợp lệ (chỉ gồm 0-9, A-F, mỗi byte 2 ký tự), ' +
      'ví dụ: "1F 0A 1E 00 0B" — đúng định dạng mà chế độ mã hóa XOR xuất ra.'
    );
  }
  if (cleaned.length % 2 !== 0) {
    throw new Error(
      `Chuỗi hex có số ký tự lẻ (${cleaned.length}) — mỗi byte cần đúng 2 ký tự hex (vd: "1F", "0A").`
    );
  }
  const bytes = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes.push(parseInt(cleaned.slice(i, i + 2), 16));
  }
  return bytes;
}

/**
 * Sinh toàn bộ danh sách bước trực quan hóa cho một phép toán bit, cùng danh
 * sách byte kết quả tương ứng.
 *
 * Chiều mã hóa (encrypt): Text A là văn bản thường — mỗi ký tự lấy mã ASCII
 * trực tiếp. Kết quả là byte "ngẫu nhiên" (thường không in được), nên được
 * hiển thị dạng hex.
 *
 * Chiều giải mã (decrypt): Text A được coi là chuỗi hex của khối mật mã đã
 * mã hóa trước đó (đúng định dạng "Hex: ..." mà chế độ mã hóa xuất ra) —
 * được parse thành byte thật TRƯỚC khi so sánh bit, thay vì lấy mã ASCII
 * của chính các ký tự hex đó (đó chính là lỗi cũ). Vì XOR tự nghịch đảo
 * (A XOR B XOR B = A), XOR lại đúng những byte mật mã này với cùng Text B
 * sẽ khôi phục lại byte văn bản gốc.
 *
 * @param {'xor'} opId
 * @param {'encrypt'|'decrypt'} mode
 * @param {string} textA
 * @param {string} textB
 * @returns {{steps: Array, resultBytes: number[]}}
 * @throws nếu mode === 'decrypt' và textA không phải chuỗi hex hợp lệ.
 */
function computeBitwiseSteps(opId, mode, textA, textB) {
  const op = BIT_OPS[opId];
  const isDecrypt = mode === 'decrypt';

  // Chiều giải mã: parse hex NGAY TỪ ĐẦU, trước khi push bất kỳ step nào —
  // nếu không hợp lệ, ném lỗi rõ ràng mà không để lại tiến trình "lửng lơ".
  const bytesA = isDecrypt ? parseHexBytes(textA) : null;

  const lengthA = isDecrypt ? bytesA.length : textA.length;
  const lengthB = textB.length;
  const length = Math.max(lengthA, lengthB, 1);
  const steps = [];
  const resultBytes = [];

  if (lengthA !== lengthB) {
    steps.push({
      type: 'notice',
      description: isDecrypt
        ? `Số byte mật mã (${lengthA}) khác độ dài Text B (${lengthB} ký tự). ` +
          'Phần thiếu ở bên ngắn hơn sẽ được coi như 0 khi so sánh bit.'
        : `Độ dài hai văn bản không bằng nhau (Text A: ${lengthA} ký tự, Text B: ${lengthB} ký tự). ` +
          'Ký tự bị thiếu ở bên ngắn hơn sẽ được coi như mã ASCII 0 (NUL) khi so sánh bit.',
    });
  }

  if (lengthA === 0 && lengthB === 0) {
    steps.push({
      type: 'notice',
      description: isDecrypt
        ? 'Chuỗi hex đầu vào và Text B đều trống — không có byte nào để giải mã.'
        : 'Cả hai văn bản đều trống — không có ký tự nào để so sánh bit.',
    });
    steps.push({
      type: 'bitwise-summary',
      isDecrypt,
      description: 'Không có byte nào để tổng hợp.',
      data: { resultBytes: [], hex: '', text: '' },
    });
    return { steps, resultBytes };
  }

  for (let i = 0; i < length; i += 1) {
    const hasA = i < lengthA;
    const hasB = i < lengthB;
    const charB = hasB ? textB[i] : '∅';
    const codeA = isDecrypt ? (hasA ? bytesA[i] : 0) : charCodeSafe(textA, i);
    const codeB = charCodeSafe(textB, i);
    const binA = toBinary8(codeA);
    const binB = toBinary8(codeB);

    steps.push({
      type: 'ascii',
      charIndex: i,
      isDecrypt,
      charA: isDecrypt ? `0x${codeA.toString(16).padStart(2, '0').toUpperCase()}` : hasA ? textA[i] : '∅',
      charB,
      codeA,
      codeB,
      description: isDecrypt
        ? `Byte ${i + 1}: A = byte mật mã 0x${codeA.toString(16).padStart(2, '0').toUpperCase()}` +
          `${hasA ? '' : ' (thiếu, coi như 0)'} = ${codeA}; ` +
          `B = "${charB}"${hasB ? '' : ' (thiếu, coi như mã 0)'} → mã ASCII ${codeB}.`
        : `Ký tự ${i + 1}: A = "${hasA ? textA[i] : '∅'}"${hasA ? '' : ' (thiếu, coi như mã 0)'} → mã ASCII ${codeA}; ` +
          `B = "${charB}"${hasB ? '' : ' (thiếu, coi như mã 0)'} → mã ASCII ${codeB}.`,
    });

    steps.push({
      type: 'binary',
      charIndex: i,
      isDecrypt,
      binA,
      binB,
      description: `${isDecrypt ? 'Byte' : 'Ký tự'} ${i + 1}: chuyển sang nhị phân 8-bit — A = ${binA}, B = ${binB}.`,
    });

    const resultBits = [];
    for (let bitPos = 0; bitPos < 8; bitPos += 1) {
      const bitA = Number(binA[bitPos]);
      const bitB = Number(binB[bitPos]);
      const resultBit = op.fn(bitA, bitB);
      const active = op.isActive(bitA, bitB);
      resultBits.push(resultBit);

      steps.push({
        type: 'bit',
        charIndex: i,
        isDecrypt,
        bitPos,
        bitNumberFromLeft: bitPos + 1,
        bitA,
        bitB,
        resultBit,
        active,
        opLabel: op.label,
        description:
          `${isDecrypt ? 'Byte' : 'Ký tự'} ${i + 1}, bit thứ ${bitPos + 1}/8 (từ trái): A=${bitA}, B=${bitB} → ` +
          `${op.label}(${bitA}, ${bitB}) = ${resultBit}${active ? ' — bit kích hoạt' : ''}.`,
      });
    }

    const resultByte = parseInt(resultBits.join(''), 2);
    resultBytes.push(resultByte);
    const resultHex = resultByte.toString(16).padStart(2, '0').toUpperCase();
    const resultChar = resultByte >= 32 && resultByte <= 126 ? String.fromCharCode(resultByte) : null;

    steps.push({
      type: 'output',
      charIndex: i,
      isDecrypt,
      resultByte,
      resultBin: resultBits.join(''),
      resultHex,
      description: isDecrypt
        ? `Byte ${i + 1}: byte gốc khôi phục = ${resultBits.join('')} (nhị phân) = ${resultByte} (thập phân) ` +
          `= 0x${resultHex} (hex)${resultChar ? ` → ký tự "${resultChar}"` : ' (không in được)'}.`
        : `Ký tự ${i + 1}: byte kết quả = ${resultBits.join('')} (nhị phân) = ${resultByte} (thập phân) ` +
          `= 0x${resultHex} (hex).`,
    });
  }

  const hex = resultBytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  const text = resultBytes.map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');

  steps.push({
    type: 'bitwise-summary',
    isDecrypt,
    description: isDecrypt
      ? `Ghép ${resultBytes.length} byte đã khôi phục lại: văn bản gốc = "${text}".`
      : `Ghép ${resultBytes.length} byte kết quả lại theo đúng thứ tự: chuỗi hex cuối cùng = "${hex}".`,
    data: { resultBytes, hex, text },
  });

  return { steps, resultBytes };
}

/** Định dạng danh sách byte kết quả thành chuỗi hiển thị ở panel Kết quả. */
function formatBitwiseResult(mode, resultBytes) {
  const isDecrypt = mode === 'decrypt';

  if (resultBytes.length === 0) {
    return isDecrypt
      ? 'Không có byte nào để giải mã (chuỗi hex đầu vào rỗng).'
      : 'Không có dữ liệu đầu ra (cả hai văn bản đều trống).';
  }

  const hex = resultBytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  const text = resultBytes.map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');

  // Giải mã: kết quả có ý nghĩa là VĂN BẢN khôi phục được, nên đưa lên đầu.
  // Mã hóa: kết quả chính là các byte (thường không in được), nên hex lên đầu.
  return isDecrypt
    ? `Văn bản đã giải mã: ${text}\nHex (tham khảo): ${hex}`
    : `Hex: ${hex}\nVăn bản (ký tự không in được hiển thị bằng dấu "."): ${text}`;
}

function registerBitwiseAlgorithm(id) {
  const op = BIT_OPS[id];
  algorithmManager.register(id, {
    label: `${op.label} (Text vs Text)`,
    requiresKey: true,
    decodable: true,
    keyHint: 'Nhập văn bản thứ hai (Text B) để so sánh từng bit với văn bản đầu vào (Text A).',
    explanation:
      `Phép toán bit ${op.label} so sánh từng bit tương ứng của hai văn bản: mỗi ký tự được chuyển ` +
      `sang mã ASCII rồi sang nhị phân 8-bit, sau đó thực hiện ${op.label} trên từng cặp bit để tạo ra ` +
      'byte kết quả. Quá trình được trực quan hóa qua 4 giai đoạn: ASCII → Nhị phân → So sánh từng bit → ' +
      'Byte kết quả. Nếu hai văn bản có độ dài khác nhau, phần thiếu được coi như mã 0 (NUL). XOR tự ' +
      'nghịch đảo (A XOR B XOR B = A) nên áp dụng lại đúng phép XOR với cùng Text B chính là "giải mã" — ' +
      'nhưng vì kết quả mã hóa là byte thô (thường không in được), chế độ Mã hóa nhận Văn bản đầu vào là ' +
      'văn bản thường và xuất ra chuỗi HEX, còn chế độ Giải mã nhận Văn bản đầu vào LÀ chuỗi hex đó ' +
      '(vd: "1F 0A 1E 00 0B") và xuất ra văn bản gốc.',
    generateSteps: ({ mode, input, key }) => computeBitwiseSteps(id, mode, input ?? '', key ?? '').steps,
    execute: ({ mode, input, key }) =>
      formatBitwiseResult(mode, computeBitwiseSteps(id, mode, input ?? '', key ?? '').resultBytes),
  });
}

['xor'].forEach(registerBitwiseAlgorithm);


// ---------------------------------------------------------------------------
// HILL CIPHER (2x2) — Trình minh họa giáo dục (educational Hill Cipher visualizer)
//
// Mã hóa khối cổ điển dựa trên đại số tuyến tính trên Z26 (modulo 26).
// Khóa là một chuỗi 4 chữ cái tạo thành ma trận 2x2 K (mỗi chữ cái → số theo
// A=0,...,Z=25, xếp theo hàng): K = [[k00, k01], [k10, k11]].
//
// Mã hóa: văn bản được lọc chỉ giữ chữ cái A-Z, đệm thêm "X" nếu số lẻ, rồi
// chia thành từng cặp ký tự (p1, p2). Mỗi cặp được nhân với K theo modulo 26:
//   [c1, c2] = K × [p1, p2] (mod 26)
//
// Giải mã: cần ma trận nghịch đảo K⁻¹ (mod 26), chỉ tồn tại khi định thức
// det(K) nguyên tố cùng nhau với 26 (ƯCLN(det, 26) = 1) — đây chính là điều
// kiện để một khóa Hill Cipher "khả nghịch" (decodable). Nếu không thỏa,
// thuật toán từ chối ngay từ generateSteps() với thông báo lỗi rõ ràng,
// TRƯỚC khi AnimationController nhận bất kỳ bước nào — tránh để lại trạng
// thái tiến trình "lửng lơ" (steps đã set nhưng không có activeRun tương ứng).
// Khi đã có K⁻¹, mỗi cặp ký tự mật mã được nhân với K⁻¹ để khôi phục [p1, p2].
// ---------------------------------------------------------------------------

/** Modulo luôn trả về số không âm (khác với toán tử % gốc của JS với số âm). */
function hillMod(n, m) {
  return ((n % m) + m) % m;
}

/** Tìm nghịch đảo modulo của a theo m (m = 26, nhỏ nên duyệt tuyến tính là đủ nhanh). Trả về null nếu không tồn tại. */
function hillModInverse(a, m) {
  const aMod = hillMod(a, m);
  for (let x = 1; x < m; x += 1) {
    if (hillMod(aMod * x, m) === 1) return x;
  }
  return null;
}

/** Chuyển khóa dạng chuỗi (>= 4 chữ cái) thành ma trận 2x2 số nguyên 0–25. */
function parseHillKey(keyText) {
  const letters = (keyText ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  if (letters.length !== 4) {
    throw new Error('Khóa cần 4 kí tự cho ma trận 2x2');
  }
  const keyLetters = letters;
  const nums = keyLetters.split('').map((ch) => ch.charCodeAt(0) - 65);
  const matrix = [
    [nums[0], nums[1]],
    [nums[2], nums[3]],
  ];
  return { keyLetters, matrix };
}

/** Định thức của ma trận 2x2, rút gọn theo modulo 26. */
function hillDeterminant(matrix) {
  const [[a, b], [c, d]] = matrix;
  return hillMod(a * d - b * c, 26);
}

/**
 * Tính ma trận nghịch đảo (mod 26) của ma trận khóa 2x2.
 * @throws nếu định thức không có nghịch đảo modulo (ƯCLN(det, 26) ≠ 1).
 */
function hillInverseMatrix(matrix) {
  const det = hillDeterminant(matrix);
  const detInv = hillModInverse(det, 26);
  if (detInv === null) {
    throw new Error(
      `Ma trận khóa không khả nghịch theo modulo 26 (định thức = ${det}, ƯCLN(${det}, 26) ≠ 1). ` +
      'Hãy chọn khóa khác sao cho định thức nguyên tố cùng nhau với 26 (vd: "HILL", "TEXT").'
    );
  }
  const [[a, b], [c, d]] = matrix;
  // Ma trận phụ hợp (adjugate) của ma trận 2x2 [[a,b],[c,d]] là [[d,-b],[-c,a]].
  const adjugate = [
    [d, hillMod(-b, 26)],
    [hillMod(-c, 26), a],
  ];
  const inverse = adjugate.map((row) => row.map((v) => hillMod(v * detInv, 26)));
  return { det, detInv, inverse };
}

function hillLetterToNum(ch) {
  return ch.charCodeAt(0) - 65;
}

function hillNumToLetter(n) {
  return String.fromCharCode(hillMod(n, 26) + 65);
}

/**
 * Sinh danh sách bước trực quan hóa + kết quả cuối cùng cho Hill Cipher,
 * dùng chung cho cả hai chiều mã hóa/giải mã (khác nhau ở ma trận sử dụng:
 * K khi mã hóa, K⁻¹ khi giải mã).
 * @param {'encrypt'|'decrypt'} mode
 * @param {string} inputText
 * @param {string} keyText
 * @returns {{steps: Array, result: string}}
 * @throws nếu khóa không hợp lệ hoặc không khả nghịch (validate ngay từ đầu,
 *   trước khi push bất kỳ step nào, cho cả hai chiều — một khóa Hill Cipher
 *   hợp lệ luôns phải khả nghịch để có thể dùng lại cho chiều ngược lại).
 */
function computeHillSteps(mode, inputText, keyText) {
  const { keyLetters, matrix: keyMatrix } = parseHillKey(keyText);
  const det = hillDeterminant(keyMatrix);
  const detInv = hillModInverse(det, 26);
  if (detInv === null) {
    throw new Error(
      `Khóa "${keyLetters}" tạo ra ma trận không khả nghịch theo modulo 26 (định thức = ${det}). ` +
      'Hãy chọn khóa khác sao cho định thức nguyên tố cùng nhau với 26 (vd: "HILL", "TEXT").'
    );
  }

  const steps = [];
  const actionLabel = mode === 'decrypt' ? 'giải mã' : 'mã hóa';

  steps.push({
    type: 'hill-input',
    description: `Đầu vào (${actionLabel}): "${inputText}".`,
    data: { text: inputText, mode },
  });

  steps.push({
    type: 'hill-key',
    description:
      `Khóa "${keyLetters}" → ma trận 2x2 K = [[${keyMatrix[0][0]}, ${keyMatrix[0][1]}], ` +
      `[${keyMatrix[1][0]}, ${keyMatrix[1][1]}]] (mỗi chữ cái → số theo A=0,...,Z=25, xếp theo hàng). ` +
      `Định thức det(K) mod 26 = ${det} — khả nghịch vì ƯCLN(${det}, 26) = 1.`,
    data: { keyLetters, matrix: keyMatrix, det },
  });

  let workingMatrix = keyMatrix;
  if (mode === 'decrypt') {
    const { inverse } = hillInverseMatrix(keyMatrix);
    workingMatrix = inverse;
    steps.push({
      type: 'hill-key-inverse',
      description:
        `Giải mã cần ma trận nghịch đảo K⁻¹ (mod 26): nghịch đảo modulo của định thức ${det} là ${detInv} ` +
        `(vì ${det}×${detInv} mod 26 = 1). Nhân định thức nghịch đảo với ma trận phụ hợp (adjugate) của K, ` +
        `ta được K⁻¹ = [[${inverse[0][0]}, ${inverse[0][1]}], [${inverse[1][0]}, ${inverse[1][1]}]] — ` +
        'dùng K⁻¹ thay cho K khi nhân với từng cặp ký tự bên dưới.',
      data: { det, detInv, inverse },
    });
  }

  const upper = (inputText ?? '').toUpperCase();
  const letters = upper.replace(/[^A-Z]/g, '');
  const removedCount = upper.length - letters.length;

  if (removedCount > 0) {
    steps.push({
      type: 'hill-notice',
      description:
        `Bỏ qua ${removedCount} ký tự không phải chữ cái A-Z (khoảng trắng, dấu câu, số...) — ` +
        'Hill Cipher cổ điển chỉ xử lý 26 chữ cái trong bảng chữ cái tiếng Anh.',
      data: { removedCount },
    });
  }

  if (letters.length === 0) {
    steps.push({
      type: 'hill-output',
      description: 'Không còn chữ cái A-Z nào sau khi lọc — không có gì để xử lý.',
      data: { result: '' },
    });
    return { steps, result: '' };
  }

  let workingLetters = letters;
  if (workingLetters.length % 2 !== 0) {
    workingLetters += 'X';
    steps.push({
      type: 'hill-notice',
      description:
        `Số chữ cái là số lẻ (${letters.length}) — thêm 1 ký tự đệm "X" vào cuối để chia hết cho 2 ` +
        '(Hill Cipher 2x2 xử lý dữ liệu theo từng cặp ký tự một lúc).',
      data: { padded: true },
    });
  }

  let output = '';
  for (let i = 0, pairIndex = 0; i < workingLetters.length; i += 2, pairIndex += 1) {
    const ch1 = workingLetters[i];
    const ch2 = workingLetters[i + 1];
    const p1 = hillLetterToNum(ch1);
    const p2 = hillLetterToNum(ch2);

    steps.push({
      type: 'hill-pair-letters',
      pairIndex,
      description: `Cặp ${pairIndex + 1}: "${ch1}${ch2}" → số (${p1}, ${p2}) theo A=0,...,Z=25.`,
      data: { ch1, ch2, p1, p2 },
    });

    const r1 = hillMod(workingMatrix[0][0] * p1 + workingMatrix[0][1] * p2, 26);
    const r2 = hillMod(workingMatrix[1][0] * p1 + workingMatrix[1][1] * p2, 26);

    steps.push({
      type: 'hill-pair-multiply',
      pairIndex,
      description:
        `Cặp ${pairIndex + 1}: nhân ma trận với vectơ (p1, p2) rồi rút gọn mod 26 — ` +
        `r1 = (${workingMatrix[0][0]}×${p1} + ${workingMatrix[0][1]}×${p2}) mod 26 = ${r1}; ` +
        `r2 = (${workingMatrix[1][0]}×${p1} + ${workingMatrix[1][1]}×${p2}) mod 26 = ${r2}.`,
      data: { p1, p2, r1, r2, matrix: workingMatrix },
    });

    const outCh1 = hillNumToLetter(r1);
    const outCh2 = hillNumToLetter(r2);

    steps.push({
      type: 'hill-pair-output',
      pairIndex,
      description: `Cặp ${pairIndex + 1}: (${r1}, ${r2}) → chữ cái "${outCh1}${outCh2}".`,
      data: { r1, r2, outCh1, outCh2 },
    });

    output += outCh1 + outCh2;
  }

  steps.push({
    type: 'hill-output',
    description: `Ghép tất cả các cặp lại theo đúng thứ tự: kết quả = "${output}".`,
    data: { result: output },
  });

  return { steps, result: output };
}

algorithmManager.register('hill', {
  label: 'Hill Cipher (2x2)',
  requiresKey: true,
  decodable: true,
  exactKeyLength: 4,
  keyHint: 'Khóa cần đúng 4 chữ cái cho ma trận 2x2 (vd: HILL). Mỗi chữ cái ứng với số A=0,...,Z=25.',
  explanation:
    'Hill Cipher là một mã hóa khối cổ điển dựa trên đại số tuyến tính: khóa là một ma trận vuông ' +
    '(ở đây là 2x2), và văn bản (chỉ gồm chữ cái A-Z) được chia thành từng cặp ký tự, chuyển sang số ' +
    '(A=0,...,Z=25), rồi nhân với ma trận khóa theo modulo 26 để tạo ra cặp ký tự mật mã. Giải mã dùng ' +
    'ma trận nghịch đảo của khóa (modulo 26) — chỉ tồn tại khi định thức của ma trận khóa nguyên tố cùng ' +
    'nhau với 26 (ƯCLN(định thức, 26) = 1). Đây là ví dụ kinh điển cho thấy vì sao một phép biến đổi cần ' +
    'khả nghịch (như XOR hay Base64) thì mới có thể giải mã được — khác với AND/OR vốn làm mất thông tin.',
  generateSteps: ({ mode, input, key }) => computeHillSteps(mode, input ?? '', key ?? '').steps,
  execute: ({ mode, input, steps }) => {
    const outputStep = steps[steps.length - 1];
    const result = outputStep && outputStep.data ? outputStep.data.result : '';
    const label = mode === 'decrypt' ? 'Giải mã' : 'Mã hóa';
    return `Hill Cipher ${label}("${input ?? ''}") = ${result}`;
  },
});

// ---------------------------------------------------------------------------
// MD5 — Trình minh họa giáo dục (educational MD5 visualizer)
//
// Theo yêu cầu: KHÔNG tự dựng lại engine MD5 để theo dõi trạng thái thanh ghi
// sau từng thao tác nội bộ (điều đó tương đương "tự cài đặt thuật toán để
// phục vụ animation"). Thay vào đó:
//   - Một thư viện MD5 gọn nhẹ, chuẩn RFC 1321 (bên dưới) CHỈ được dùng để
//     tính digest cuối cùng — một hàm thuần túy nhận chuỗi, trả về hex.
//   - Các bước trực quan hóa (đệm, chia khối, khởi tạo buffer, 4 vòng) mô tả
//     cấu trúc/công thức ở mức khái niệm bằng dữ liệu thật (độ dài, số khối,
//     hex của từng khối, hằng số khởi tạo) mà KHÔNG mô phỏng lại từng thao
//     tác nội bộ của 4 vòng.
// ---------------------------------------------------------------------------

/* ---- Thư viện MD5 gọn nhẹ (RFC 1321) — chỉ dùng để tính digest cuối cùng ---- */

const MD5_K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
  0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
  0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
  0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
  0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
  0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
  0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

function md5LeftRotate(x, c) {
  return ((x << c) | (x >>> (32 - c))) >>> 0;
}

/** Chuẩn bị dữ liệu đầu vào đã đệm theo RFC 1321, trả về mảng byte (Array<number>). */
function md5PadBytes(bytes, bitLen) {
  const padded = bytes.slice();
  padded.push(0x80);
  while (padded.length % 64 !== 56) padded.push(0x00);
  const lenLow = bitLen >>> 0;
  const lenHigh = Math.floor(bitLen / 0x100000000) >>> 0;
  for (let i = 0; i < 4; i += 1) padded.push((lenLow >>> (8 * i)) & 0xff);
  for (let i = 0; i < 4; i += 1) padded.push((lenHigh >>> (8 * i)) & 0xff);
  return padded;
}

/**
 * Thư viện MD5 gọn nhẹ — CHỈ dùng để tính digest cuối cùng.
 * @param {string} input
 * @returns {string} chuỗi hex 32 ký tự (128-bit), chữ thường.
 */
function md5Hex(input) {
  const bytes = Array.from(new TextEncoder().encode(input));
  const bitLen = bytes.length * 8;
  const padded = md5PadBytes(bytes, bitLen);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let chunkStart = 0; chunkStart < padded.length; chunkStart += 64) {
    const M = new Array(16);
    for (let j = 0; j < 16; j += 1) {
      const o = chunkStart + j * 4;
      M[j] =
        (padded[o] | (padded[o + 1] << 8) | (padded[o + 2] << 16) | (padded[o + 3] << 24)) >>> 0;
    }

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i += 1) {
      let F;
      let g;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + MD5_K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + md5LeftRotate(F, MD5_S[i])) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const toHexLE = (n) =>
    [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

  return toHexLE(a0) + toHexLE(b0) + toHexLE(c0) + toHexLE(d0);
}

/* ---- Sinh các bước trực quan hóa mang tính khái niệm/cấu trúc ---- */

const MD5_ROUND_INFO = [
  {
    n: 1,
    fn: 'F(B,C,D) = (B AND C) OR (NOT B AND D)',
    order: 'Dùng từ thông điệp theo đúng thứ tự: g = i.',
    shifts: '7, 12, 17, 22',
  },
  {
    n: 2,
    fn: 'G(B,C,D) = (D AND B) OR (NOT D AND C)',
    order: 'Thứ tự từ thông điệp: g = (5×i + 1) mod 16.',
    shifts: '5, 9, 14, 20',
  },
  {
    n: 3,
    fn: 'H(B,C,D) = B XOR C XOR D',
    order: 'Thứ tự từ thông điệp: g = (3×i + 5) mod 16.',
    shifts: '4, 11, 16, 23',
  },
  {
    n: 4,
    fn: 'I(B,C,D) = C XOR (B OR NOT D)',
    order: 'Thứ tự từ thông điệp: g = (7×i) mod 16.',
    shifts: '6, 10, 15, 21',
  },
];

function computeMd5Steps(inputText) {
  const steps = [];
  const bytes = Array.from(new TextEncoder().encode(inputText));
  const bitLen = bytes.length * 8;

  steps.push({
    type: 'md5-input',
    description: `Đầu vào: "${inputText}" — ${bytes.length} byte (${bitLen} bit) sau khi mã hóa UTF-8.`,
    data: { text: inputText, byteLength: bytes.length, bitLength: bitLen },
  });

  const prePadding = bytes.length + 1;
  const padded = md5PadBytes(bytes, bitLen);
  const zerosAdded = padded.length - 8 - prePadding;

  steps.push({
    type: 'md5-padding',
    description:
      `Đệm dữ liệu: thêm 1 byte 0x80 (bit "1" đầu tiên), sau đó thêm ${Math.max(zerosAdded, 0)} byte 0x00, ` +
      `rồi thêm độ dài gốc (${bitLen} bit) dưới dạng số nguyên 64-bit little-endian. ` +
      `Tổng độ dài sau khi đệm: ${padded.length} byte (${padded.length / 64} khối 512-bit).`,
    data: {
      paddedLength: padded.length,
      blockCount: padded.length / 64,
      appendedZeroBytes: Math.max(zerosAdded, 0),
    },
  });

  const blockCount = padded.length / 64;
  const blockHexes = [];
  for (let b = 0; b < blockCount; b += 1) {
    const slice = padded.slice(b * 64, (b + 1) * 64);
    blockHexes.push(slice.map((x) => x.toString(16).padStart(2, '0')).join(''));
  }

  steps.push({
    type: 'md5-blocks',
    description:
      `Chia dữ liệu đã đệm thành ${blockCount} khối 512-bit (64 byte). Mỗi khối được chia tiếp thành ` +
      '16 từ 32-bit để đưa vào 4 vòng biến đổi.',
    data: { blockCount, blockHexes },
  });

  steps.push({
    type: 'md5-buffers',
    description:
      'Khởi tạo 4 thanh ghi 32-bit (buffer) theo chuẩn RFC 1321: ' +
      'A = 0x67452301, B = 0xEFCDAB89, C = 0x98BADCFE, D = 0x10325476.',
    data: { A: '67452301', B: 'efcdab89', C: '98badcfe', D: '10325476' },
  });

  MD5_ROUND_INFO.forEach((round) => {
    steps.push({
      type: 'md5-round',
      description:
        `Vòng ${round.n}: áp dụng hàm phi tuyến ${round.fn} cho 16 thao tác trên mỗi khối. ${round.order} ` +
        'Mỗi thao tác cộng thêm một hằng số T[i] (bảng 64 hằng số dựa trên hàm sin) rồi xoay trái ' +
        `thanh ghi B với số bit dịch chuyển lần lượt là ${round.shifts} (lặp lại theo nhóm 4 thao tác).`,
      data: round,
    });
  });

  steps.push({
    type: 'md5-digest',
    description:
      'Cộng dồn A, B, C, D vào các thanh ghi ban đầu sau mỗi khối; sau khi xử lý hết các khối, ghép 4 ' +
      'thanh ghi (little-endian) để tạo digest 128-bit cuối cùng.',
    data: {},
  });

  return { steps, blockHexes };
}

algorithmManager.register('md5', {
  label: 'MD5 (Minh họa)',
  requiresKey: false,
  keyHint: '',
  explanation:
    'MD5 (Message-Digest Algorithm 5) là một hàm băm mật mã học tạo ra digest 128-bit từ dữ liệu đầu ' +
    'vào bất kỳ. Thuật toán xử lý dữ liệu theo từng khối 512-bit qua 4 vòng biến đổi, mỗi vòng gồm 16 ' +
    'thao tác phi tuyến dựa trên các hàm F, G, H, I. MD5 hiện được coi là KHÔNG an toàn về mặt mật mã ' +
    'học (dễ bị tấn công đụng độ — collision) và chỉ nên dùng cho mục đích học tập hoặc kiểm tra tính ' +
    'toàn vẹn phi bảo mật.',
  generateSteps: ({ input }) => computeMd5Steps(input ?? '').steps,
  execute: ({ input }) => `MD5("${input ?? ''}") = ${md5Hex(input ?? '')}`,
});

// ---------------------------------------------------------------------------
// SHA-256 — Trình minh họa giáo dục (educational SHA-256 visualizer)
//
// Digest cuối cùng được tính bằng Web Crypto API (crypto.subtle.digest) —
// KHÔNG tự cài đặt hàm nén SHA-256. Các bước trực quan hóa mô tả cấu trúc/
// công thức ở mức khái niệm (Input → Padding → Khối 512-bit → Lịch trình
// thông điệp → Vòng nén → Digest), dùng dữ liệu thật cho các phần đơn giản
// (độ dài, số khối, hex khối, 16 từ đầu tiên của lịch trình thông điệp)
// nhưng KHÔNG mô phỏng lại toàn bộ 64 vòng nén nội bộ.
// ---------------------------------------------------------------------------

const SHA256_H_INIT = [
  '6a09e667', 'bb67ae85', '3c6ef372', 'a54ff53a',
  '510e527f', '9b05688c', '1f83d9ab', '5be0cd19',
];

/** Đệm dữ liệu theo chuẩn SHA-256: độ dài gốc được thêm dưới dạng 64-bit BIG-ENDIAN (khác MD5). */
function sha256PadBytes(bytes, bitLen) {
  const padded = bytes.slice();
  padded.push(0x80);
  while (padded.length % 64 !== 56) padded.push(0x00);
  const lenHigh = Math.floor(bitLen / 0x100000000) >>> 0;
  const lenLow = bitLen >>> 0;
  for (let i = 3; i >= 0; i -= 1) padded.push((lenHigh >>> (8 * i)) & 0xff);
  for (let i = 3; i >= 0; i -= 1) padded.push((lenLow >>> (8 * i)) & 0xff);
  return padded;
}

/**
 * Tính SHA-256 hex bằng Web Crypto API — CHỈ dùng để lấy digest cuối cùng.
 * @param {string} input
 * @returns {Promise<string>} chuỗi hex 64 ký tự (256-bit), chữ thường.
 */
async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function computeSha256Steps(inputText) {
  const steps = [];
  const bytes = Array.from(new TextEncoder().encode(inputText));
  const bitLen = bytes.length * 8;

  steps.push({
    type: 'sha256-input',
    description: `Đầu vào: "${inputText}" — ${bytes.length} byte (${bitLen} bit) sau khi mã hóa UTF-8.`,
    data: { text: inputText, byteLength: bytes.length, bitLength: bitLen },
  });

  const prePadding = bytes.length + 1;
  const padded = sha256PadBytes(bytes, bitLen);
  const zerosAdded = padded.length - 8 - prePadding;

  steps.push({
    type: 'sha256-padding',
    description:
      `Đệm dữ liệu: thêm 1 byte 0x80 (bit "1" đầu tiên), sau đó thêm ${Math.max(zerosAdded, 0)} byte 0x00, ` +
      `rồi thêm độ dài gốc (${bitLen} bit) dưới dạng số nguyên 64-bit BIG-ENDIAN (khác với MD5 dùng ` +
      `little-endian). Tổng độ dài sau khi đệm: ${padded.length} byte (${padded.length / 64} khối 512-bit).`,
    data: {
      paddedLength: padded.length,
      blockCount: padded.length / 64,
      appendedZeroBytes: Math.max(zerosAdded, 0),
    },
  });

  const blockCount = padded.length / 64;
  const blockHexes = [];
  for (let b = 0; b < blockCount; b += 1) {
    const slice = padded.slice(b * 64, (b + 1) * 64);
    blockHexes.push(slice.map((x) => x.toString(16).padStart(2, '0')).join(''));
  }

  steps.push({
    type: 'sha256-blocks',
    description:
      `Chia dữ liệu đã đệm thành ${blockCount} khối 512-bit (64 byte). Mỗi khối gồm 16 từ 32-bit ` +
      '(big-endian), dùng làm 16 từ đầu tiên của lịch trình thông điệp cho khối đó.',
    data: { blockCount, blockHexes },
  });

  // 16 từ 32-bit đầu tiên (big-endian) của khối đầu tiên — dữ liệu thật, dễ tính (chỉ là phân tích byte).
  const firstBlock = padded.slice(0, 64);
  const w0to15 = [];
  for (let j = 0; j < 16; j += 1) {
    const o = j * 4;
    const word =
      ((firstBlock[o] << 24) | (firstBlock[o + 1] << 16) | (firstBlock[o + 2] << 8) | firstBlock[o + 3]) >>> 0;
    w0to15.push(word.toString(16).padStart(8, '0'));
  }

  steps.push({
    type: 'sha256-schedule',
    description:
      'Lịch trình thông điệp (message schedule): W[0..15] lấy trực tiếp từ 16 từ 32-bit của khối. ' +
      'W[16..63] được mở rộng bằng công thức W[t] = σ1(W[t-2]) + W[t-7] + σ0(W[t-15]) + W[t-16], trong đó ' +
      'σ0(x) = ROTR7(x) XOR ROTR18(x) XOR SHR3(x) và σ1(x) = ROTR17(x) XOR ROTR19(x) XOR SHR10(x). ' +
      'Kết quả: 64 từ 32-bit dùng cho 64 vòng nén.',
    data: { w0to15 },
  });

  steps.push({
    type: 'sha256-compression',
    description:
      'Vòng nén: khởi tạo 8 biến làm việc a..h từ 8 giá trị băm hiện tại (ban đầu là các hằng số H0..H7 ' +
      'lấy từ căn bậc hai của 8 số nguyên tố đầu tiên). Với mỗi vòng t = 0..63: T1 = h + Σ1(e) + Ch(e,f,g) ' +
      '+ K[t] + W[t]; T2 = Σ0(a) + Maj(a,b,c); rồi dịch chuyển h=g, g=f, f=e, e=d+T1, d=c, c=b, b=a, a=T1+T2 ' +
      '(Σ0, Σ1 dùng phép xoay phải khác với σ0, σ1 ở bước lịch trình; Ch, Maj là các hàm chọn/đa số theo bit). ' +
      'Sau 64 vòng, cộng dồn a..h vào 8 giá trị băm hiện tại.',
    data: { hInit: SHA256_H_INIT },
  });

  steps.push({
    type: 'sha256-digest',
    description:
      'Sau khi xử lý hết tất cả các khối, ghép 8 giá trị băm 32-bit (big-endian) lại để tạo digest ' +
      '256-bit cuối cùng — được tính bằng Web Crypto API (crypto.subtle.digest) để đảm bảo độ chính xác.',
    data: {},
  });

  return { steps, blockHexes };
}

algorithmManager.register('sha256', {
  label: 'SHA-256',
  requiresKey: false,
  keyHint: '',
  explanation:
    'SHA-256 (Secure Hash Algorithm 256-bit) là một hàm băm mật mã học thuộc họ SHA-2, tạo ra digest ' +
    '256-bit từ dữ liệu đầu vào bất kỳ. Thuật toán xử lý dữ liệu theo từng khối 512-bit qua 64 vòng nén, ' +
    'mỗi vòng sử dụng các hàm Ch, Maj, Σ0, Σ1 cùng một lịch trình thông điệp 64 từ được mở rộng từ 16 từ ' +
    'gốc của khối. SHA-256 hiện được coi là an toàn về mặt mật mã học và được dùng rộng rãi (chữ ký số, ' +
    'blockchain, kiểm tra toàn vẹn dữ liệu).',
  generateSteps: ({ input }) => computeSha256Steps(input ?? '').steps,
  execute: async ({ input }) => `SHA-256("${input ?? ''}") = ${await sha256Hex(input ?? '')}`,
});

// ---------------------------------------------------------------------------
// BASE64 — Trình minh họa giáo dục (educational Base64 visualizer)
//
// Chiều mã hóa (encrypt): dữ liệu được mã hóa UTF-8 thành byte, chia thành
// từng khối 3 byte (24 bit); mỗi khối được ghép thành một chuỗi bit liên tục,
// chia thành 4 nhóm 6-bit (đệm thêm bit 0 nếu khối cuối thiếu byte), rồi tra
// từng nhóm trong bảng 64 ký tự Base64. Nếu khối cuối thiếu byte, các vị trí
// ký tự còn thiếu được điền bằng dấu "=".
//
// Chiều giải mã (decrypt): ngược lại — với mỗi nhóm 4 ký tự, tra chỉ số
// ngược trong bảng (bỏ qua ký tự đệm "="), ghép các nhóm 6-bit thành một
// chuỗi bit liên tục, rồi chia lại thành byte 8-bit (bỏ các bit dư cuối
// cùng phát sinh từ phần đệm) trước khi giải mã UTF-8 thành văn bản.
//
// Theo yêu cầu: các bước trực quan hóa ở trên tự tính toán bằng logic thật
// (không phải placeholder). API trình duyệt gốc (btoa/atob) CHỈ được dùng ở
// bước execute() để lấy kết quả cuối cùng làm giá trị đối chiếu/xác thực,
// tương tự cách SHA-256 dùng crypto.subtle cho digest cuối cùng.
// ---------------------------------------------------------------------------

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function printableCharSuffix(byteValue) {
  return byteValue >= 32 && byteValue <= 126 ? ` ("${String.fromCharCode(byteValue)}")` : '';
}

/**
 * Sinh danh sách bước trực quan hóa cho chiều MÃ HÓA Base64.
 * @param {string} inputText
 * @returns {{steps: Array, result: string}}
 */
function computeBase64EncodeSteps(inputText) {
  const steps = [];
  const bytes = Array.from(new TextEncoder().encode(inputText));
  const byteLength = bytes.length;
  const bitLength = byteLength * 8;

  steps.push({
    type: 'b64-input',
    description: `Đầu vào: "${inputText}" — ${byteLength} byte (${bitLength} bit) sau khi mã hóa UTF-8.`,
    data: { text: inputText, byteLength, bitLength },
  });

  if (byteLength === 0) {
    steps.push({
      type: 'b64-output',
      description: 'Chuỗi đầu vào rỗng — kết quả Base64 cũng là chuỗi rỗng.',
      data: { result: '' },
    });
    return { steps, result: '' };
  }

  let output = '';

  for (let i = 0, chunkIndex = 0; i < byteLength; i += 3, chunkIndex += 1) {
    const chunkBytes = bytes.slice(i, i + 3);

    steps.push({
      type: 'b64-ascii',
      chunkIndex,
      description:
        `Khối ${chunkIndex + 1}: ${chunkBytes.length} byte — ` +
        chunkBytes
          .map((b, idx) => `byte ${i + idx + 1} = ${b}${printableCharSuffix(b)}`)
          .join(', ') +
        '.',
      data: { bytes: chunkBytes, startIndex: i },
    });

    const binaries = chunkBytes.map(toBinary8);
    steps.push({
      type: 'b64-binary',
      chunkIndex,
      description: `Khối ${chunkIndex + 1}: chuyển mỗi byte sang nhị phân 8-bit — ${binaries.join(' ')}.`,
      data: { binaries },
    });

    const bitString = binaries.join('');
    const dataGroups = Math.ceil(bitString.length / 6);
    const paddedBitString = bitString.padEnd(dataGroups * 6, '0');
    const zeroBitsAdded = paddedBitString.length - bitString.length;
    const groups = [];
    for (let g = 0; g < dataGroups; g += 1) {
      groups.push(paddedBitString.slice(g * 6, g * 6 + 6));
    }

    steps.push({
      type: 'b64-group6',
      chunkIndex,
      description:
        `Khối ${chunkIndex + 1}: ghép ${bitString.length} bit thành chuỗi liên tục` +
        (zeroBitsAdded > 0 ? `, đệm thêm ${zeroBitsAdded} bit 0 để đủ nhóm 6-bit` : '') +
        `, rồi chia thành ${dataGroups} nhóm 6-bit: ${groups.join(' ')}.`,
      data: { bitString, paddedBitString, groups, zeroBitsAdded },
    });

    const lookupChars = groups.map((g) => {
      const value = parseInt(g, 2);
      return { bits: g, value, char: BASE64_ALPHABET[value] };
    });
    const padCharsCount = 4 - dataGroups;

    steps.push({
      type: 'b64-lookup',
      chunkIndex,
      description:
        `Khối ${chunkIndex + 1}: tra bảng Base64 (64 ký tự A–Z, a–z, 0–9, +, /) — ` +
        lookupChars.map((l) => `${l.bits} = ${l.value} → "${l.char}"`).join(', ') +
        (padCharsCount > 0 ? `, thêm ${padCharsCount} ký tự đệm "=".` : '.'),
      data: { lookupChars, padCharsCount },
    });

    if (padCharsCount > 0) {
      steps.push({
        type: 'b64-padding',
        chunkIndex,
        description:
          `Khối ${chunkIndex + 1} chỉ có ${chunkBytes.length} byte (thay vì 3), nên chỉ tạo được ` +
          `${dataGroups} ký tự Base64 thật; ${padCharsCount} vị trí còn lại trong nhóm 4 ký tự được ` +
          'điền bằng dấu "=" để báo hiệu bên giải mã biết phần dữ liệu bị thiếu.',
        data: { padCharsCount },
      });
    }

    output += lookupChars.map((l) => l.char).join('') + '='.repeat(padCharsCount);
  }

  steps.push({
    type: 'b64-output',
    description: `Ghép tất cả các nhóm 4 ký tự lại theo đúng thứ tự: kết quả Base64 = "${output}".`,
    data: { result: output },
  });

  return { steps, result: output };
}

/**
 * Sinh danh sách bước trực quan hóa cho chiều GIẢI MÃ Base64.
 * @param {string} inputText
 * @returns {{steps: Array, bytes: number[], resultText: string}}
 */
function computeBase64DecodeSteps(inputText) {
  const steps = [];
  const cleaned = (inputText ?? '').replace(/\s+/g, '');
  const length = cleaned.length;

  steps.push({
    type: 'b64d-input',
    description: `Đầu vào Base64: "${cleaned}" — ${length} ký tự.`,
    data: { text: cleaned, length },
  });

  if (length === 0) {
    steps.push({
      type: 'b64d-output',
      description: 'Chuỗi Base64 rỗng — kết quả giải mã cũng là chuỗi rỗng.',
      data: { resultText: '', byteCount: 0 },
    });
    return { steps, bytes: [], resultText: '' };
  }

  if (length % 4 !== 0) {
    steps.push({
      type: 'b64d-padding',
      description:
        `Cảnh báo: độ dài chuỗi Base64 (${length} ký tự) không chia hết cho 4 — chuỗi có thể bị cắt hoặc ` +
        'sai định dạng. Vẫn tiếp tục xử lý theo từng nhóm 4 ký tự; nhóm cuối cùng có thể bị thiếu ký tự.',
      data: {},
    });
  }

  const outBytes = [];

  for (let i = 0, chunkIndex = 0; i < length; i += 4, chunkIndex += 1) {
    const quantum = cleaned.slice(i, i + 4);
    const chars = quantum.split('');
    const padCount = chars.filter((c) => c === '=').length;
    const validChars = chars.filter((c) => c !== '=');

    const lookup = validChars.map((c) => {
      const value = BASE64_ALPHABET.indexOf(c);
      const safeValue = value >= 0 ? value : 0;
      return { char: c, value: safeValue, bits: toBinary6(safeValue), valid: value >= 0 };
    });

    steps.push({
      type: 'b64d-lookup',
      chunkIndex,
      description:
        `Nhóm ${chunkIndex + 1}: tra chỉ số ngược trong bảng Base64 — ` +
        (lookup.length > 0
          ? lookup
              .map((l) => `"${l.char}" → ${l.value} = ${l.bits}${l.valid ? '' : ' (ký tự không hợp lệ)'}`)
              .join(', ')
          : 'không có ký tự hợp lệ nào') +
        (padCount > 0 ? `; bỏ qua ${padCount} ký tự đệm "=".` : '.'),
      data: { lookup, padCount },
    });

    const bitString = lookup.map((l) => l.bits).join('');
    const fullByteCount = Math.floor(bitString.length / 8);
    const usableBits = bitString.slice(0, fullByteCount * 8);
    const discardedBits = bitString.length - usableBits.length;

    const chunkBytes = [];
    for (let b = 0; b < fullByteCount; b += 1) {
      chunkBytes.push(parseInt(usableBits.slice(b * 8, b * 8 + 8), 2));
    }

    steps.push({
      type: 'b64d-regroup',
      chunkIndex,
      description:
        `Nhóm ${chunkIndex + 1}: ghép ${bitString.length} bit từ các ký tự hợp lệ, chia lại thành ` +
        `${fullByteCount} byte 8-bit` +
        (discardedBits > 0 ? ` (bỏ ${discardedBits} bit thừa ở cuối do phần đệm)` : '') +
        '.',
      data: { bitString, chunkBytes, discardedBits },
    });

    steps.push({
      type: 'b64d-ascii',
      chunkIndex,
      description:
        chunkBytes.length > 0
          ? `Nhóm ${chunkIndex + 1}: giá trị byte thu được — ` +
            chunkBytes
              .map((b, idx) => `byte ${outBytes.length + idx + 1} = ${b}${printableCharSuffix(b)}`)
              .join(', ') +
            '.'
          : `Nhóm ${chunkIndex + 1}: không tạo ra byte nào (toàn bộ là ký tự đệm).`,
      data: { bytes: chunkBytes },
    });

    if (padCount > 0) {
      steps.push({
        type: 'b64d-padding',
        chunkIndex,
        description:
          `Nhóm ${chunkIndex + 1} có ${padCount} ký tự đệm "=", nghĩa là khối gốc lúc mã hóa chỉ có ` +
          `${chunkBytes.length} byte thay vì 3.`,
        data: { padCount },
      });
    }

    outBytes.push(...chunkBytes);
  }

  let resultText;
  try {
    resultText = new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(outBytes));
  } catch (error) {
    resultText = '';
  }

  steps.push({
    type: 'b64d-output',
    description: `Ghép ${outBytes.length} byte và giải mã UTF-8: kết quả = "${resultText}".`,
    data: { resultText, byteCount: outBytes.length },
  });

  return { steps, bytes: outBytes, resultText };
}

/**
 * Mã hóa Base64 bằng API gốc của trình duyệt (TextEncoder + btoa) — dùng để
 * XÁC THỰC kết quả cuối cùng, KHÔNG dùng để sinh bước trực quan hóa.
 * @param {string} text
 * @returns {string}
 */
function nativeBase64Encode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

/**
 * Giải mã Base64 bằng API gốc của trình duyệt (atob + TextDecoder) — dùng để
 * XÁC THỰC kết quả cuối cùng, KHÔNG dùng để sinh bước trực quan hóa.
 * @param {string} base64Text
 * @returns {string}
 * @throws nếu chuỗi Base64 không hợp lệ theo atob().
 */
function nativeBase64Decode(base64Text) {
  const cleaned = (base64Text ?? '').replace(/\s+/g, '');
  let binary;
  try {
    binary = atob(cleaned);
  } catch (error) {
    throw new Error('Chuỗi Base64 không hợp lệ — không thể giải mã.');
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

algorithmManager.register('base64', {
  label: 'Base64',
  requiresKey: false,
  keyHint: '',
  decodable: true,
  explanation:
    'Base64 là phương pháp biểu diễn dữ liệu nhị phân dưới dạng chuỗi ký tự ASCII an toàn để truyền qua ' +
    'các kênh chỉ hỗ trợ văn bản. Khi mã hóa, dữ liệu được chia thành từng khối 3 byte (24 bit); mỗi khối ' +
    'được ghép thành chuỗi bit liên tục rồi chia thành 4 nhóm 6-bit, mỗi nhóm (giá trị 0–63) được tra ' +
    'trong bảng 64 ký tự (A–Z, a–z, 0–9, +, /). Nếu khối cuối thiếu byte, các vị trí ký tự còn thiếu được ' +
    'điền bằng dấu "=". Khi giải mã, quá trình được thực hiện ngược lại: tra chỉ số ngược, ghép bit, rồi ' +
    'chia lại thành byte 8-bit. Đây KHÔNG phải là phương pháp mã hóa bảo mật — bất kỳ ai cũng có thể giải ' +
    'mã Base64 mà không cần khóa.',
  generateSteps: ({ mode, input }) =>
    mode === 'decrypt'
      ? computeBase64DecodeSteps(input ?? '').steps
      : computeBase64EncodeSteps(input ?? '').steps,
  execute: ({ mode, input }) => {
    if (mode === 'decrypt') {
      const decoded = nativeBase64Decode(input ?? '');
      return `Base64 Decode("${input ?? ''}") = ${decoded}`;
    }
    const encoded = nativeBase64Encode(input ?? '');
    return `Base64 Encode("${input ?? ''}") = ${encoded}`;
  },
});