import { TradeLogService } from './trade-log.service';

function decimal(value: number) {
  return { toNumber: () => value };
}

function createTestService(): TradeLogService {
  const trades = new Map<string, any>();
  const setupDefinitions = new Map<number, any>();
  const setupDefinitionsByKey = new Map<string, any>();
  const ruleViolationDefinitions = new Map<number, any>();
  const ruleViolationDefinitionsByKey = new Map<string, any>();
  const lessonDefinitions = new Map<number, any>();
  const lessonDefinitionsByKey = new Map<string, any>();
  const resultLabelDefinitions = new Map<number, any>();
  const resultLabelDefinitionsByKey = new Map<string, any>();
  let sequence = 0;
  let tagSequence = 0;

  const normalizeKey = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  const now = () => new Date('2026-06-29T00:00:00.000Z');
  const updatedNow = () => new Date('2026-06-29T00:01:00.000Z');

  const ensureDefinition = (
    store: Map<number, any>,
    byKey: Map<string, any>,
    field: string,
    row: { label: string; normalizedLabel: string; systemDefined?: boolean },
  ) => {
    const existing = byKey.get(row.normalizedLabel);
    if (existing) {
      return existing;
    }
    tagSequence += 1;
    const definition = {
      id: tagSequence,
      field,
      label: row.label,
      normalizedLabel: row.normalizedLabel,
      systemDefined: row.systemDefined ?? false,
      createdAt: now(),
      updatedAt: now(),
    };
    store.set(definition.id, definition);
    byKey.set(definition.normalizedLabel, definition);
    return definition;
  };

  const createLinks = (tradeId: string, items: Array<{ tag: { connect: { id: number } } }> | undefined, store: Map<number, any>, prefix: string) =>
    (items ?? []).map((item, index) => ({
      id: `${prefix}-${tradeId}-${index + 1}`,
      tradeId,
      tagId: item.tag.connect.id,
      createdAt: updatedNow(),
      tag: store.get(item.tag.connect.id),
    }));

  const prisma: any = {
    $transaction: jest.fn(async (callback: (tx: any) => Promise<any>) => callback(prisma)),
    setupTagDefinition: {
      createMany: jest.fn(({ data }) => {
        for (const row of data) {
          ensureDefinition(setupDefinitions, setupDefinitionsByKey, 'SETUP', row);
        }
        return Promise.resolve({ count: data.length });
      }),
      findMany: jest.fn(({ where } = {}) => {
        const values = Array.from(setupDefinitions.values());
        if (where?.normalizedLabel?.in) {
          return Promise.resolve(values.filter((row) => where.normalizedLabel.in.includes(row.normalizedLabel)));
        }
        return Promise.resolve(values.sort((a, b) => a.label.localeCompare(b.label)));
      }),
    },
    ruleViolationTagDefinition: {
      createMany: jest.fn(({ data }) => {
        for (const row of data) {
          ensureDefinition(ruleViolationDefinitions, ruleViolationDefinitionsByKey, 'RULE_VIOLATION', row);
        }
        return Promise.resolve({ count: data.length });
      }),
      findMany: jest.fn(({ where } = {}) => {
        const values = Array.from(ruleViolationDefinitions.values());
        if (where?.normalizedLabel?.in) {
          return Promise.resolve(values.filter((row) => where.normalizedLabel.in.includes(row.normalizedLabel)));
        }
        return Promise.resolve(values.sort((a, b) => a.label.localeCompare(b.label)));
      }),
    },
    lessonTagDefinition: {
      createMany: jest.fn(({ data }) => {
        for (const row of data) {
          ensureDefinition(lessonDefinitions, lessonDefinitionsByKey, 'LESSON', row);
        }
        return Promise.resolve({ count: data.length });
      }),
      findMany: jest.fn(({ where } = {}) => {
        const values = Array.from(lessonDefinitions.values());
        if (where?.normalizedLabel?.in) {
          return Promise.resolve(values.filter((row) => where.normalizedLabel.in.includes(row.normalizedLabel)));
        }
        return Promise.resolve(values.sort((a, b) => a.label.localeCompare(b.label)));
      }),
    },
    resultLabelTagDefinition: {
      createMany: jest.fn(({ data }) => {
        for (const row of data) {
          ensureDefinition(resultLabelDefinitions, resultLabelDefinitionsByKey, 'RESULT_LABEL', row);
        }
        return Promise.resolve({ count: data.length });
      }),
      findMany: jest.fn(({ where } = {}) => {
        const values = Array.from(resultLabelDefinitions.values());
        if (where?.normalizedLabel?.in) {
          return Promise.resolve(values.filter((row) => where.normalizedLabel.in.includes(row.normalizedLabel)));
        }
        return Promise.resolve(values.sort((a, b) => a.label.localeCompare(b.label)));
      }),
    },
    tradeEntry: {
      findUnique: jest.fn(({ where }) => Promise.resolve(trades.get(where.tradeId)?.entry ?? null)),
      update: jest.fn(({ where, data }) => {
        const trade = trades.get(where.tradeId);
        if (!trade?.entry) {
          return Promise.resolve(null);
        }
        trade.entry = {
          ...trade.entry,
          price: decimal(typeof data.price?.toNumber === 'function' ? data.price.toNumber() : data.price ?? trade.entry.price.toNumber()),
          quantity:
            data.quantity === null
              ? null
              : data.quantity === undefined
                ? trade.entry.quantity
                : decimal(typeof data.quantity?.toNumber === 'function' ? data.quantity.toNumber() : data.quantity),
          occurredAt: data.occurredAt ?? trade.entry.occurredAt,
          note: data.note ?? trade.entry.note,
        };
        return Promise.resolve(trade.entry);
      }),
    },
    tradeExit: {
      findUnique: jest.fn(({ where }) => Promise.resolve(trades.get(where.tradeId)?.exit ?? null)),
      update: jest.fn(({ where, data }) => {
        const trade = trades.get(where.tradeId);
        if (!trade?.exit) {
          return Promise.resolve(null);
        }
        trade.exit = {
          ...trade.exit,
          price: decimal(typeof data.price?.toNumber === 'function' ? data.price.toNumber() : data.price ?? trade.exit.price.toNumber()),
          quantity:
            data.quantity === null
              ? null
              : data.quantity === undefined
                ? trade.exit.quantity
                : decimal(typeof data.quantity?.toNumber === 'function' ? data.quantity.toNumber() : data.quantity),
          occurredAt: data.occurredAt ?? trade.exit.occurredAt,
          reason: data.reason ?? trade.exit.reason,
          note: data.note ?? trade.exit.note,
        };
        return Promise.resolve(trade.exit);
      }),
    },
    trade: {
      create: jest.fn(({ data }) => {
        sequence += 1;
        const tradeId = `trade-${sequence}`;
        const trade = {
          id: tradeId,
          symbol: data.symbol,
          side: data.side,
          status: data.status,
          timeframe: data.timeframe ?? null,
          session: data.session ?? null,
          strategy: data.strategy ?? null,
          thesis: data.thesis ?? null,
          note: data.note ?? null,
          journal: data.journal ?? null,
          resultLabelTagId: data.resultLabelTagId ?? null,
          resultLabelTag: data.resultLabelTagId ? resultLabelDefinitions.get(data.resultLabelTagId) ?? null : null,
          createdAt: now(),
          updatedAt: now(),
          entry: null,
          exit: null,
          setupTagLinks: createLinks(tradeId, data.setupTagLinks?.create, setupDefinitions, 'setup-link'),
          ruleViolationTagLinks: createLinks(
            tradeId,
            data.ruleViolationTagLinks?.create,
            ruleViolationDefinitions,
            'violation-link',
          ),
          lessonTagLinks: createLinks(tradeId, data.lessonTagLinks?.create, lessonDefinitions, 'lesson-link'),
        };
        trades.set(trade.id, trade);
        return Promise.resolve(trade);
      }),
      findMany: jest.fn(({ where } = {}) => {
        let values = Array.from(trades.values());
        if (where?.status) {
          values = values.filter((trade) => trade.status === where.status);
        }
        if (where?.entry?.isNot === null) {
          values = values.filter((trade) => trade.entry !== null);
        }
        if (where?.exit?.isNot === null) {
          values = values.filter((trade) => trade.exit !== null);
        }
        return Promise.resolve(values);
      }),
      findUnique: jest.fn(({ where, select }) => {
        const trade = trades.get(where.id ?? where.tradeId) ?? null;
        if (!trade) {
          return Promise.resolve(null);
        }
        if (select?.entry) {
          return Promise.resolve({ entry: trade.entry });
        }
        return Promise.resolve(trade);
      }),
      update: jest.fn(({ where, data }) => {
        const trade = trades.get(where.id);
        if (!trade) {
          return Promise.resolve(null);
        }
        const updated = {
          ...trade,
          symbol: data.symbol ?? trade.symbol,
          side: data.side ?? trade.side,
          status: data.status ?? trade.status,
          timeframe: data.timeframe ?? trade.timeframe,
          session: data.session ?? trade.session,
          strategy: data.strategy ?? trade.strategy,
          thesis: data.thesis ?? trade.thesis,
          note: data.note ?? trade.note,
          journal: data.journal ?? trade.journal,
          resultLabelTagId: data.resultLabelTagId ?? trade.resultLabelTagId,
          resultLabelTag:
            data.resultLabelTagId !== undefined
              ? data.resultLabelTagId === null
                ? null
                : resultLabelDefinitions.get(data.resultLabelTagId) ?? null
              : trade.resultLabelTag,
          updatedAt: updatedNow(),
          setupTagLinks:
            data.setupTagLinks
              ? createLinks(where.id, data.setupTagLinks.create, setupDefinitions, 'setup-link')
              : trade.setupTagLinks,
          ruleViolationTagLinks:
            data.ruleViolationTagLinks
              ? createLinks(where.id, data.ruleViolationTagLinks.create, ruleViolationDefinitions, 'violation-link')
              : trade.ruleViolationTagLinks,
          lessonTagLinks:
            data.lessonTagLinks
              ? createLinks(where.id, data.lessonTagLinks.create, lessonDefinitions, 'lesson-link')
              : trade.lessonTagLinks,
        };
        if (data.entry?.create) {
          updated.entry = {
            ...data.entry.create,
            price: decimal(data.entry.create.price),
            quantity: data.entry.create.quantity === undefined ? null : decimal(data.entry.create.quantity),
            occurredAt: data.entry.create.occurredAt,
            note: data.entry.create.note ?? null,
          };
        }
        if (data.exit?.create) {
          updated.exit = {
            ...data.exit.create,
            price: decimal(data.exit.create.price),
            quantity: data.exit.create.quantity === undefined ? null : decimal(data.exit.create.quantity),
            occurredAt: data.exit.create.occurredAt,
            reason: data.exit.create.reason ?? null,
            note: data.exit.create.note ?? null,
          };
        }
        trades.set(where.id, updated);
        return Promise.resolve(updated);
      }),
    },
  };

  return new TradeLogService(prisma as never);
}

describe('TradeLogService', () => {
  it('reports trade-log health', () => {
    const service = createTestService();

    expect(service.health()).toMatchObject({
      status: 'ok',
      service: 'sentra-trade-log',
    });
    expect(typeof service.health().timestamp).toBe('string');
  });

  it('starts with no trades', async () => {
    const service = createTestService();

    await expect(service.listTrades()).resolves.toEqual([]);
  });

  it('derives wiki-aligned trade stats for review and process dashboards', async () => {
    const service = createTestService();

    const asiaGood = await service.createTrade({
      symbol: 'GOLD',
      side: 'long',
      timeframe: '5m',
      journal: {
        plan: {
          setupType: '투볼',
          setupTag: '투볼',
          confirmations: ['추세', '지지', '볼추이지캔'],
          stopLossPrice: 4171,
          takeProfitPrice: 4191,
          calmState: true,
        },
      },
    });
    await service.recordEntry(asiaGood.id, {
      price: 4175,
      quantity: 0.01,
      occurredAt: '2026-07-03T04:30:00.000Z',
    });
    await service.recordExit(asiaGood.id, {
      price: 4178,
      quantity: 0.01,
      occurredAt: '2026-07-03T04:40:00.000Z',
      reason: 'manual',
    });
    await service.patchTradeJournal(asiaGood.id, {
      review: {
        processVerdict: 'good',
        resultLabel: '익절',
        lessons: ['기준봉 유지'],
        lessonTags: ['keep-management-timeframe'],
      },
    });

    const nyBad = await service.createTrade({
      symbol: 'GOLD',
      side: 'long',
      timeframe: '5m',
      journal: {
        plan: {
          setupType: '투볼',
          setupTag: '투볼',
          confirmations: ['추세'],
          stopLossPrice: 4157,
        },
      },
    });
    await service.recordEntry(nyBad.id, {
      price: 4164.46,
      quantity: 0.01,
      occurredAt: '2026-07-03T14:00:29.000Z',
    });
    await service.recordExit(nyBad.id, {
      price: 4156.9,
      quantity: 0.01,
      occurredAt: '2026-07-03T14:08:58.000Z',
      reason: 'stop_loss',
    });
    await service.patchTradeJournal(nyBad.id, {
      review: {
        processVerdict: 'bad',
        resultLabel: '손절',
        ruleViolations: ['볼추이지캔 없음', '기준봉 불일치'],
        ruleViolationTags: ['missing-entry-confirmation', 'timeframe-inconsistency'],
        lessons: ['기준봉 유지'],
        lessonTags: ['keep-management-timeframe'],
      },
    });

    await service.createTrade({
      symbol: 'GOLD',
      side: 'short',
      timeframe: '1m',
      journal: {
        plan: {
          setupType: '정볼',
          setupTag: '정볼',
          confirmations: ['추세', '저항', '캔들'],
          takeProfitPrice: 4170,
        },
        review: {
          processVerdict: 'observe',
          resultLabel: '본절 청산',
        },
      },
    });

    const stats = await service.getStats();

    expect(stats.overview).toMatchObject({
      totalTrades: 2,
      totalRealizedPoints: -4.56,
      averageRealizedPoints: -2.28,
      winRate: 50,
      goodCount: 1,
      observeCount: 0,
      badCount: 1,
      repeatBanCount: 0,
    });
    expect(stats.checklistRates).toMatchObject({
      stopLossDefinedRate: 100,
      takeProfitDefinedRate: 50,
      confirmationsAtLeastThreeRate: 50,
      calmStateRate: 50,
      ruleViolationTaggedRate: 50,
      lessonsTaggedRate: 100,
    });
    expect(stats.topRuleViolations).toEqual([
      { label: '기준봉/관리봉 불일치', count: 1 },
      { label: '필수 진입 확인 부재', count: 1 },
    ]);
    expect(stats.topLessons).toEqual([{ label: '진입 기준봉으로 관리 유지', count: 2 }]);
    expect(stats.bySession).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Asia', count: 1, winRate: 100, realizedPoints: 3, goodCount: 1 }),
        expect.objectContaining({ label: 'New York', count: 1, winRate: 0, realizedPoints: -7.56, badCount: 1 }),
      ]),
    );
    expect(stats.byTimeframe).toEqual([
      expect.objectContaining({ label: '5m', count: 2, winRate: 50, realizedPoints: -4.56, goodCount: 1, badCount: 1 }),
    ]);
    expect(stats.bySetupType).toEqual([
      expect.objectContaining({ key: '투볼', label: '투볼', count: 2, winRate: 50, realizedPoints: -4.56, goodCount: 1, badCount: 1 }),
    ]);
  });

  it('creates planned independent trades for the same symbol and side', async () => {
    const service = createTestService();

    const first = await service.createTrade({
      symbol: 'BTCUSDT',
      side: 'long',
      timeframe: '15m',
      thesis: 'London sweep reclaim',
    });
    const second = await service.createTrade({
      symbol: 'BTCUSDT',
      side: 'long',
      timeframe: '5m',
      thesis: 'Separate CFD position',
    });

    expect(first).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'long',
      status: 'planned',
      timeframe: '15m',
      thesis: 'London sweep reclaim',
    });
    expect(second).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'long',
      status: 'planned',
      timeframe: '5m',
      thesis: 'Separate CFD position',
    });
    expect(first.id).not.toBe(second.id);
    await expect(service.listTrades()).resolves.toHaveLength(2);
  });

  it('stores structured journal context derived from the trading wiki', async () => {
    const service = createTestService();

    const trade = await service.createTrade({
      symbol: 'XAUUSD',
      side: 'short',
      timeframe: '1h',
      session: 'New York',
      thesis: '추세 하락 + 투볼 + 저항 확인',
      journal: {
        plan: {
          setupType: '투볼',
          entryModel: '하락 추세 continuation',
          confirmations: ['볼린저 밴드', '추세', '지지·저항'],
          stopLossPrice: 4190.5,
          takeProfitPrice: 4160.0,
          plannedLossAmount: 3.5,
          dailyLossLimit: 20,
          calmState: true,
        },
        management: {
          breakevenRule: '직전 고점 기준으로 보호 손절 이동',
          exitTriggers: ['볼린저 밴드 수축', '반대 꼬리 강함'],
        },
      },
    });

    expect(trade).toMatchObject({
      symbol: 'XAUUSD',
      journal: {
        plan: {
          setupType: '투볼',
          setupTag: '투볼',
          setupTags: ['투볼'],
          confirmations: ['볼린저 밴드', '추세', '지지·저항'],
          stopLossPrice: 4190.5,
          dailyLossLimit: 20,
          calmState: true,
        },
        management: {
          breakevenRule: '직전 고점 기준으로 보호 손절 이동',
          exitTriggers: ['볼린저 밴드 수축', '반대 꼬리 강함'],
        },
      },
    });
  });

  it('patches journal context after the trade to add management and review data', async () => {
    const service = createTestService();
    const trade = await service.createTrade({
      symbol: 'XAUUSD',
      side: 'short',
      journal: {
        plan: {
          setupType: '정볼',
          confirmations: ['추세', '20MA'],
        },
      },
    });

    const updated = await service.patchTradeJournal(trade.id, {
      management: {
        breakevenRule: '1 point 이하 수익권은 본절 취급',
      },
      review: {
        resultLabel: '본절 청산',
        processVerdict: 'observe',
        realizedPnlText: '$0.06',
      },
    });

    expect(updated.journal).toMatchObject({
      plan: {
        setupType: '정볼',
        setupTag: '정볼',
        setupTags: ['정볼'],
        confirmations: ['추세', '20MA'],
      },
      management: {
        breakevenRule: '1 point 이하 수익권은 본절 취급',
      },
      review: {
        resultLabel: '본절 청산',
        processVerdict: 'observe',
        realizedPnlText: '$0.06',
      },
    });
  });
  it('preserves setup, review, and result tags on note-only updates when journal is absent', async () => {
    const service = createTestService();
    const trade = await service.createTrade({
      symbol: 'XAUUSD',
      side: 'long',
      note: '원볼 체크',
      journal: {
        plan: {
          setupTag: '원볼',
        },
        review: {
          resultLabel: '익절',
          ruleViolationTags: ['targetalignmentmissing'],
          lessonTags: ['splitindependenttrades'],
        },
      },
    });

    const updated = await service.updateTrade(trade.id, {
      note: '투볼 메모로 수정',
    });

    expect(updated.note).toBe('투볼 메모로 수정');
    expect(updated.journal).toMatchObject({
      review: {
        resultLabel: '익절',
        ruleViolationTags: ['목표 계획 정합성 부족'],
        lessonTags: ['독립 trade 분리 유지'],
      },
    });
    expect(updated.tags).toMatchObject({
      setupTags: [expect.objectContaining({ label: '원볼' })],
      ruleViolationTags: [expect.objectContaining({ label: '목표 계획 정합성 부족' })],
      lessonTags: [expect.objectContaining({ label: '독립 trade 분리 유지' })],
      resultLabel: expect.objectContaining({ label: '익절' }),
    });
  });

  it('preserves existing tags on thesis-only updates when journal is absent', async () => {
    const service = createTestService();
    const trade = await service.createTrade({
      symbol: 'XAUUSD',
      side: 'short',
      thesis: '정볼 아이디어',
      journal: {
        plan: {
          setupTag: '정볼',
        },
        review: {
          resultLabel: '손절',
          ruleViolationTags: ['prematurestopmove'],
          lessonTags: ['keepentryconfirmationrequirements'],
        },
      },
    });

    const updated = await service.updateTrade(trade.id, {
      thesis: '원볼 아이디어로 설명만 수정',
    });

    expect(updated.thesis).toBe('원볼 아이디어로 설명만 수정');
    expect(updated.journal).toMatchObject({
      review: {
        resultLabel: '손절',
        ruleViolationTags: ['SL 조기 이동'],
        lessonTags: ['필수 진입 확인 조건 유지'],
      },
    });
    expect(updated.tags).toMatchObject({
      setupTags: [expect.objectContaining({ label: '정볼' })],
      ruleViolationTags: [expect.objectContaining({ label: 'SL 조기 이동' })],
      lessonTags: [expect.objectContaining({ label: '필수 진입 확인 조건 유지' })],
      resultLabel: expect.objectContaining({ label: '손절' }),
    });
  });

  it('normalizes legacy review slug aliases to canonical Korean labels', async () => {
    const service = createTestService();

    const trade = await service.createTrade({
      symbol: 'XAUUSD',
      side: 'long',
      journal: {
        review: {
          ruleViolationTags: [
            'targetalignmentmissing',
            'prematurestopmove',
            'entrybeforerequiredclose',
            'nodependentsetupvalidation',
          ],
          lessonTags: [
            'keepentryconfirmationrequirements',
            'revalidatebeforereentry',
            'splitindependenttrades',
            'isolatetesttrades',
          ],
        },
      },
    });

    expect(trade.journal?.review?.ruleViolationTags).toEqual([
      '목표 계획 정합성 부족',
      'SL 조기 이동',
      '봉마감 확인 없이 진입',
      '하위 setup 독립 검증 부재',
    ]);
    expect(trade.journal?.review?.lessonTags).toEqual([
      '필수 진입 확인 조건 유지',
      '재진입 전 추세 재검증',
      '독립 trade 분리 유지',
      '테스트성 거래 분리 관리',
    ]);
    expect(trade.tags?.ruleViolationTags.map((tag) => tag.label)).toEqual([
      '목표 계획 정합성 부족',
      'SL 조기 이동',
      '봉마감 확인 없이 진입',
      '하위 setup 독립 검증 부재',
    ]);
    expect(trade.tags?.lessonTags.map((tag) => tag.label)).toEqual([
      '필수 진입 확인 조건 유지',
      '재진입 전 추세 재검증',
      '독립 trade 분리 유지',
      '테스트성 거래 분리 관리',
    ]);
  });

  it('records entry separately from trade creation and opens the trade', async () => {
    const service = createTestService();
    const trade = await service.createTrade({ symbol: 'ETHUSDT', side: 'short' });

    const updated = await service.recordEntry(trade.id, {
      price: 3500,
      quantity: 2,
      occurredAt: '2026-06-26T10:00:00.000Z',
      note: 'Initial short entry',
    });

    expect(updated).toMatchObject({
      id: trade.id,
      status: 'open',
      entry: {
        price: 3500,
        quantity: 2,
        occurredAt: '2026-06-26T10:00:00.000Z',
        note: 'Initial short entry',
      },
    });
  });

  it('auto-detects Asia session from entry time in Korea morning', async () => {
    const service = createTestService();
    const trade = await service.createTrade({ symbol: 'XAUUSD', side: 'short' });

    const updated = await service.recordEntry(trade.id, {
      price: 4182.86,
      quantity: 0.01,
      occurredAt: '2026-07-03T02:45:55.000Z',
    });

    expect(updated.session).toBe('Asia');
  });

  it('treats pre-London late Asia entries as Asia based on entry time', async () => {
    const service = createTestService();
    const trade = await service.createTrade({ symbol: 'XAUUSD', side: 'long' });

    const updated = await service.recordEntry(trade.id, {
      price: 4165.23,
      quantity: 0.01,
      occurredAt: '2026-07-03T06:29:58.000Z',
    });

    expect(updated.session).toBe('Asia');
  });

  it('prefers inferred entry-time session over a stale stored session label', async () => {
    const service = createTestService();
    const trade = await service.createTrade({ symbol: 'XAUUSD', side: 'long', session: 'Off session' });
    await service.recordEntry(trade.id, {
      price: 4165.23,
      quantity: 0.01,
      occurredAt: '2026-07-03T06:29:58.000Z',
    });

    await expect(service.getTrade(trade.id)).resolves.toMatchObject({ session: 'Asia' });
  });

  it('auto-detects London and New York sessions with DST-aware market hours, otherwise off session', async () => {
    const service = createTestService();

    const london = await service.createTrade({ symbol: 'BTCUSDT', side: 'long' });
    const ny = await service.createTrade({ symbol: 'BTCUSDT', side: 'long' });
    const off = await service.createTrade({ symbol: 'BTCUSDT', side: 'long' });

    await expect(
      service.recordEntry(london.id, {
        price: 100,
        quantity: 1,
        occurredAt: '2026-07-03T07:30:00.000Z',
      }),
    ).resolves.toMatchObject({ session: 'London' });

    await expect(
      service.recordEntry(ny.id, {
        price: 101,
        quantity: 1,
        occurredAt: '2026-07-03T12:30:00.000Z',
      }),
    ).resolves.toMatchObject({ session: 'New York' });

    await expect(
      service.recordEntry(off.id, {
        price: 102,
        quantity: 1,
        occurredAt: '2026-07-03T21:00:00.000Z',
      }),
    ).resolves.toMatchObject({ session: 'Off session' });
  });

  it('records exit separately from entry and closes the trade', async () => {
    const service = createTestService();
    const trade = await service.createTrade({ symbol: 'ETHUSDT', side: 'short' });
    await service.recordEntry(trade.id, {
      price: 3500,
      quantity: 2,
      occurredAt: '2026-06-26T10:00:00.000Z',
    });

    const updated = await service.recordExit(trade.id, {
      price: 3400,
      quantity: 2,
      occurredAt: '2026-06-26T11:00:00.000Z',
      reason: 'target_hit',
      note: 'Target reached',
    });

    expect(updated).toMatchObject({
      id: trade.id,
      status: 'closed',
      exit: {
        price: 3400,
        quantity: 2,
        occurredAt: '2026-06-26T11:00:00.000Z',
        reason: 'target_hit',
        note: 'Target reached',
      },
    });
  });

  it('rejects exit before entry and keeps trade planned', async () => {
    const service = createTestService();
    const trade = await service.createTrade({ symbol: 'BTCUSDT', side: 'long' });

    await expect(
      service.recordExit(trade.id, {
        price: 67400,
        quantity: 0.05,
        occurredAt: '2026-06-29T00:00:00.000Z',
        reason: 'manual',
      }),
    ).rejects.toThrow('Cannot exit before entry');

    await expect(service.getTrade(trade.id)).resolves.toMatchObject({ status: 'planned' });
  });

  it('rejects a second entry on the same trade', async () => {
    const service = createTestService();
    const trade = await service.createTrade({ symbol: 'BTCUSDT', side: 'long' });
    await service.recordEntry(trade.id, {
      price: 67320,
      quantity: 0.05,
      occurredAt: '2026-06-29T00:00:00.000Z',
    });

    await expect(
      service.recordEntry(trade.id, {
        price: 67400,
        quantity: 0.05,
        occurredAt: '2026-06-29T00:10:00.000Z',
      }),
    ).rejects.toThrow('Trade already has an entry');
  });

  it('rejects a second exit on a closed trade', async () => {
    const service = createTestService();
    const trade = await service.createTrade({ symbol: 'BTCUSDT', side: 'long' });
    await service.recordEntry(trade.id, {
      price: 67320,
      quantity: 0.05,
      occurredAt: '2026-06-29T00:00:00.000Z',
    });
    await service.recordExit(trade.id, {
      price: 67400,
      quantity: 0.05,
      occurredAt: '2026-06-29T00:10:00.000Z',
      reason: 'manual',
    });

    await expect(
      service.recordExit(trade.id, {
        price: 67500,
        quantity: 0.05,
        occurredAt: '2026-06-29T00:20:00.000Z',
        reason: 'manual',
      }),
    ).rejects.toThrow('Trade already has an exit');
  });

  it('applies assistant actions to create and open a new trade', async () => {
    const service = createTestService();

    const response = await service.applyAssistantActions({
      rawText: 'BTC 15분봉 롱 진입했어. 67320에 0.05개.',
      source: 'telegram',
      actions: [
        {
          type: 'create_trade',
          payload: { symbol: 'BTCUSDT', side: 'long', timeframe: '15m' },
        },
        {
          type: 'record_entry',
          tradeRef: 'last_created',
          payload: {
            price: 67320,
            quantity: 0.05,
            occurredAt: '2026-06-29T00:00:00.000Z',
          },
        },
      ],
    });

    expect(response.rawText).toBe('BTC 15분봉 롱 진입했어. 67320에 0.05개.');
    expect(response.source).toBe('telegram');
    expect(response.trades).toHaveLength(1);
    expect(response.trades[0]).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'long',
      status: 'open',
      timeframe: '15m',
      entry: {
        price: 67320,
        quantity: 0.05,
        occurredAt: '2026-06-29T00:00:00.000Z',
      },
    });
  });

  it('applies assistant actions to create, open, and close a trade in one request', async () => {
    const service = createTestService();

    const response = await service.applyAssistantActions({
      rawText: 'BTC 15분봉 롱 진입 후 목표 청산했어.',
      source: 'telegram',
      actions: [
        {
          type: 'create_trade',
          payload: { symbol: 'BTCUSDT', side: 'long', timeframe: '15m' },
        },
        {
          type: 'record_entry',
          tradeRef: 'last_created',
          payload: {
            price: 67320,
            quantity: 0.05,
            occurredAt: '2026-06-29T00:00:00.000Z',
          },
        },
        {
          type: 'record_exit',
          tradeRef: 'last_created',
          payload: {
            price: 67400,
            quantity: 0.05,
            occurredAt: '2026-06-29T00:10:00.000Z',
            reason: 'target_hit',
          },
        },
      ],
    });

    expect(response.rawText).toBe('BTC 15분봉 롱 진입 후 목표 청산했어.');
    expect(response.source).toBe('telegram');
    expect(response.trades).toHaveLength(1);
    expect(response.trades[0]).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'long',
      status: 'closed',
      timeframe: '15m',
      entry: {
        price: 67320,
        quantity: 0.05,
        occurredAt: '2026-06-29T00:00:00.000Z',
      },
      exit: {
        price: 67400,
        quantity: 0.05,
        occurredAt: '2026-06-29T00:10:00.000Z',
        reason: 'target_hit',
      },
    });
  });

  it('creates separate trades for same symbol same side assistant actions', async () => {
    const service = createTestService();

    const first = await service.applyAssistantActions({
      rawText: 'BTC long first position',
      source: 'manual',
      actions: [
        { type: 'create_trade', payload: { symbol: 'BTCUSDT', side: 'long' } },
        {
          type: 'record_entry',
          tradeRef: 'last_created',
          payload: { price: 67320, quantity: 0.05, occurredAt: '2026-06-29T00:00:00.000Z' },
        },
      ],
    });
    const second = await service.applyAssistantActions({
      rawText: 'BTC long second independent position',
      source: 'manual',
      actions: [
        { type: 'create_trade', payload: { symbol: 'BTCUSDT', side: 'long' } },
        {
          type: 'record_entry',
          tradeRef: 'last_created',
          payload: { price: 67400, quantity: 0.03, occurredAt: '2026-06-29T00:10:00.000Z' },
        },
      ],
    });

    expect(first.trades[0].id).not.toBe(second.trades[0].id);
    await expect(service.listTrades()).resolves.toHaveLength(2);
    await expect(service.listTrades()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entry: expect.objectContaining({ price: 67320 }) }),
        expect.objectContaining({ entry: expect.objectContaining({ price: 67400 }) }),
      ]),
    );
  });

  it('applies assistant journal patches for review-stage metadata', async () => {
    const service = createTestService();
    const trade = await service.createTrade({ symbol: 'XAUUSD', side: 'short' });

    const response = await service.applyAssistantActions({
      rawText: '본절 청산. 실제 이익은 $0.06',
      source: 'telegram',
      actions: [
        {
          type: 'patch_trade_journal',
          tradeId: trade.id,
          payload: {
            review: {
              resultLabel: '본절 청산',
              realizedPnlText: '$0.06',
              reviewNotes: '1 point 이하 수익권은 본절 취급',
            },
          },
        },
      ],
    });

    expect(response.trades).toHaveLength(1);
    expect(response.trades[0].journal).toMatchObject({
      review: {
        resultLabel: '본절 청산',
        realizedPnlText: '$0.06',
        reviewNotes: '1 point 이하 수익권은 본절 취급',
      },
    });
  });

  it('syncs mt5 trades through the fixed mt5 bridge script', async () => {
    const originalAccountNumber = process.env.MT5_ACCOUNT_NUMBER;
    const originalReadOnlyPassword = process.env.MT5_READ_ONLY_PASSWORD;
    const originalBridgeStdout = process.env.MT5_SYNC_BRIDGE_STDOUT;

    process.env.MT5_ACCOUNT_NUMBER = '12345678';
    process.env.MT5_READ_ONLY_PASSWORD = 'read-only-secret';
    process.env.MT5_SYNC_BRIDGE_STDOUT = JSON.stringify({
      rawText: 'mt5 sync',
      source: 'api',
      actions: [{ type: 'create_trade', payload: { symbol: 'GOLD', side: 'long', timeframe: '5m', thesis: 'MT5 import' } }],
    });

    try {
      const service = createTestService();
      const response = await service.syncMt5Trades();

      expect(response).toMatchObject({
        source: 'mt5',
        importedCount: 1,
      });
      expect(response.trades).toHaveLength(1);
      expect(response.trades[0]).toMatchObject({
        symbol: 'GOLD',
        side: 'long',
        status: 'planned',
        timeframe: '5m',
        thesis: 'MT5 import',
      });
    } finally {
      if (originalAccountNumber === undefined) {
        delete process.env.MT5_ACCOUNT_NUMBER;
      } else {
        process.env.MT5_ACCOUNT_NUMBER = originalAccountNumber;
      }
      if (originalReadOnlyPassword === undefined) {
        delete process.env.MT5_READ_ONLY_PASSWORD;
      } else {
        process.env.MT5_READ_ONLY_PASSWORD = originalReadOnlyPassword;
      }
      if (originalBridgeStdout === undefined) {
        delete process.env.MT5_SYNC_BRIDGE_STDOUT;
      } else {
        process.env.MT5_SYNC_BRIDGE_STDOUT = originalBridgeStdout;
      }
    }
  });

  it('does not leak unrelated process env into the mt5 sync bridge', async () => {
    const originalAccountNumber = process.env.MT5_ACCOUNT_NUMBER;
    const originalReadOnlyPassword = process.env.MT5_READ_ONLY_PASSWORD;
    const originalBridgeStdout = process.env.MT5_SYNC_BRIDGE_STDOUT;
    const originalBaitSecret = process.env.MT5_BAIT_SECRET;

    process.env.MT5_ACCOUNT_NUMBER = '12345678';
    process.env.MT5_READ_ONLY_PASSWORD = 'read-only-secret';
    process.env.MT5_BAIT_SECRET = 'should-not-leak';
    process.env.MT5_SYNC_BRIDGE_STDOUT = JSON.stringify({
      rawText: 'mt5 sync',
      source: 'api',
      actions: [{ type: 'create_trade', payload: { symbol: 'GOLD', side: 'long', thesis: 'isolated' } }],
    });

    try {
      const service = createTestService();
      const response = await service.syncMt5Trades();

      expect(response.trades[0]).toMatchObject({
        symbol: 'GOLD',
        thesis: 'isolated',
      });
    } finally {
      if (originalAccountNumber === undefined) {
        delete process.env.MT5_ACCOUNT_NUMBER;
      } else {
        process.env.MT5_ACCOUNT_NUMBER = originalAccountNumber;
      }
      if (originalReadOnlyPassword === undefined) {
        delete process.env.MT5_READ_ONLY_PASSWORD;
      } else {
        process.env.MT5_READ_ONLY_PASSWORD = originalReadOnlyPassword;
      }
      if (originalBridgeStdout === undefined) {
        delete process.env.MT5_SYNC_BRIDGE_STDOUT;
      } else {
        process.env.MT5_SYNC_BRIDGE_STDOUT = originalBridgeStdout;
      }
      if (originalBaitSecret === undefined) {
        delete process.env.MT5_BAIT_SECRET;
      } else {
        process.env.MT5_BAIT_SECRET = originalBaitSecret;
      }
    }
  });

  it('rejects mt5 sync payloads with unsupported assistant actions', async () => {
    const originalAccountNumber = process.env.MT5_ACCOUNT_NUMBER;
    const originalReadOnlyPassword = process.env.MT5_READ_ONLY_PASSWORD;
    const originalBridgeStdout = process.env.MT5_SYNC_BRIDGE_STDOUT;

    process.env.MT5_ACCOUNT_NUMBER = '12345678';
    process.env.MT5_READ_ONLY_PASSWORD = 'read-only-secret';
    process.env.MT5_SYNC_BRIDGE_STDOUT = JSON.stringify({
      rawText: 'mt5 sync',
      source: 'api',
      actions: [{ type: 'unknown_action', payload: {} }],
    });

    try {
      const service = createTestService();
      await expect(service.syncMt5Trades()).rejects.toThrow('MT5 sync bridge returned invalid payload');
    } finally {
      if (originalAccountNumber === undefined) {
        delete process.env.MT5_ACCOUNT_NUMBER;
      } else {
        process.env.MT5_ACCOUNT_NUMBER = originalAccountNumber;
      }
      if (originalReadOnlyPassword === undefined) {
        delete process.env.MT5_READ_ONLY_PASSWORD;
      } else {
        process.env.MT5_READ_ONLY_PASSWORD = originalReadOnlyPassword;
      }
      if (originalBridgeStdout === undefined) {
        delete process.env.MT5_SYNC_BRIDGE_STDOUT;
      } else {
        process.env.MT5_SYNC_BRIDGE_STDOUT = originalBridgeStdout;
      }
    }
  });

  it('preserves rawText in the created trade note when note is otherwise absent', async () => {
    const service = createTestService();

    const response = await service.applyAssistantActions({
      rawText: 'ETH 숏 아이디어. 구조 깨짐.',
      source: 'telegram',
      actions: [{ type: 'create_trade', payload: { symbol: 'ETHUSDT', side: 'short' } }],
    });

    expect(response.trades[0]).toMatchObject({
      symbol: 'ETHUSDT',
      side: 'short',
      status: 'planned',
      note: 'ETH 숏 아이디어. 구조 깨짐.',
    });
  });

  it('rejects trade creation without a non-empty symbol', async () => {
    const service = createTestService();

    await expect(service.createTrade({ symbol: ' ', side: 'long' })).rejects.toThrow('symbol is required');
  });

  it('rejects trade creation with an invalid side', async () => {
    const service = createTestService();

    await expect(service.createTrade({ symbol: 'BTCUSDT', side: 'buy' as never })).rejects.toThrow(
      'side must be long or short',
    );
  });

  it('rejects non-positive entry price', async () => {
    const service = createTestService();
    const trade = await service.createTrade({ symbol: 'BTCUSDT', side: 'long' });

    await expect(
      service.recordEntry(trade.id, {
        price: 0,
        quantity: 0.05,
        occurredAt: '2026-06-29T00:00:00.000Z',
      }),
    ).rejects.toThrow('entry price must be positive');
  });

  it('rejects non-positive exit quantity', async () => {
    const service = createTestService();
    const trade = await service.createTrade({ symbol: 'BTCUSDT', side: 'long' });
    await service.recordEntry(trade.id, {
      price: 67320,
      quantity: 0.05,
      occurredAt: '2026-06-29T00:00:00.000Z',
    });

    await expect(
      service.recordExit(trade.id, {
        price: 67400,
        quantity: 0,
        occurredAt: '2026-06-29T00:10:00.000Z',
      }),
    ).rejects.toThrow('exit quantity must be positive');
  });

  it('rejects invalid entry occurrence timestamps', async () => {
    const service = createTestService();
    const trade = await service.createTrade({ symbol: 'BTCUSDT', side: 'long' });

    await expect(
      service.recordEntry(trade.id, {
        price: 67320,
        occurredAt: 'not-a-date',
      }),
    ).rejects.toThrow('entry occurredAt must be a valid date');
  });
});
