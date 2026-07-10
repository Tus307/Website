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
   * @returns {{steps: Array, result: string}}
   */
  run(id, { mode = 'encrypt', input = '', key = '' } = {}) {
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

    const result = entry.execute({ mode, input, key, steps });

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

algorithmManager.register('sha256', {
  label: 'SHA-256',
  requiresKey: false,
  keyHint: '',
  explanation:
    'SHA-256 là một hàm băm mật mã học thuộc họ SHA-2, biến đổi dữ liệu đầu vào có độ dài bất kỳ thành một chuỗi băm cố định 256-bit. Hàm băm là một chiều, không thể đảo ngược để lấy lại dữ liệu gốc.',
});

algorithmManager.register('base64', {
  label: 'Base64',
  requiresKey: false,
  keyHint: '',
  explanation:
    'Base64 là phương pháp mã hóa biểu diễn dữ liệu nhị phân dưới dạng chuỗi ký tự ASCII, thường dùng để truyền dữ liệu qua các kênh chỉ hỗ trợ văn bản. Đây KHÔNG phải là một phương pháp mã hóa bảo mật.',
});