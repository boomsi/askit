import {
  isGuestToHostEventName,
  isHostToGuestEventName,
  validateGuestToHostPayload,
  validateHostToGuestPayload,
} from './generated';

describe('SET_TOOLBOX_ENTRIES 契约事件', () => {
  describe('事件名守卫', () => {
    it('SET_TOOLBOX_ENTRIES / SET_TOOLBOX_ENTRIES_RESULT 已注册', () => {
      expect(isGuestToHostEventName('SET_TOOLBOX_ENTRIES')).toBe(true);
      expect(isHostToGuestEventName('SET_TOOLBOX_ENTRIES_RESULT')).toBe(true);
    });
    it('未知事件名拒绝', () => {
      expect(isGuestToHostEventName('TOOLBOX_ENTRIES')).toBe(false);
      expect(isHostToGuestEventName('TOOLBOX_ENTRIES_RESULT')).toBe(false);
    });
  });

  describe('SET_TOOLBOX_ENTRIES payload', () => {
    it('必填 requestId + entries', () => {
      expect(
        validateGuestToHostPayload('SET_TOOLBOX_ENTRIES', { requestId: 'r1', entries: {} })
      ).toBe(true);
      // 缺 requestId 拒绝
      expect(validateGuestToHostPayload('SET_TOOLBOX_ENTRIES', { entries: {} })).toBe(false);
      // 缺 entries 拒绝（entries 必传，内字段才可选）
      expect(validateGuestToHostPayload('SET_TOOLBOX_ENTRIES', { requestId: 'r1' })).toBe(false);
    });

    it('entries 必传，内字段可选（未传=true 是 host 语义，见 loom toolboxEntries）', () => {
      expect(
        validateGuestToHostPayload('SET_TOOLBOX_ENTRIES', {
          requestId: 'r1',
          entries: {},
        })
      ).toBe(true);
      expect(
        validateGuestToHostPayload('SET_TOOLBOX_ENTRIES', {
          requestId: 'r1',
          entries: { camera: false },
        })
      ).toBe(true);
    });

    it('entries 各入口字段可选 boolean', () => {
      expect(
        validateGuestToHostPayload('SET_TOOLBOX_ENTRIES', {
          requestId: 'r1',
          entries: {
            camera: false,
            photo: true,
            file: false,
            location: true,
            webSearch: false,
            sendKey: true,
          },
        })
      ).toBe(true);
      // 只传部分入口也合法
      expect(
        validateGuestToHostPayload('SET_TOOLBOX_ENTRIES', {
          requestId: 'r1',
          entries: { camera: false },
        })
      ).toBe(true);
    });

    it('入口字段类型校验（非 boolean 拒绝）', () => {
      expect(
        validateGuestToHostPayload('SET_TOOLBOX_ENTRIES', {
          requestId: 'r1',
          entries: { camera: 'no' },
        })
      ).toBe(false);
    });

    it('非对象拒绝', () => {
      expect(validateGuestToHostPayload('SET_TOOLBOX_ENTRIES', null)).toBe(false);
      expect(validateGuestToHostPayload('SET_TOOLBOX_ENTRIES', 'x')).toBe(false);
    });
  });

  describe('SET_TOOLBOX_ENTRIES_RESULT payload', () => {
    it('必填 requestId + success', () => {
      expect(
        validateHostToGuestPayload('SET_TOOLBOX_ENTRIES_RESULT', {
          requestId: 'r1',
          success: true,
        })
      ).toBe(true);
      expect(
        validateHostToGuestPayload('SET_TOOLBOX_ENTRIES_RESULT', {
          requestId: 'r1',
        })
      ).toBe(false);
      expect(
        validateHostToGuestPayload('SET_TOOLBOX_ENTRIES_RESULT', {
          success: true,
        })
      ).toBe(false);
    });

    it('可选 error', () => {
      expect(
        validateHostToGuestPayload('SET_TOOLBOX_ENTRIES_RESULT', {
          requestId: 'r1',
          success: false,
          error: 'boom',
        })
      ).toBe(true);
    });
  });
});
