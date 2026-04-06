import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet,
  Dimensions, Animated, Modal, ScrollView,
} from 'react-native';
import { shuffleTiles, isSolved, countCorrect } from '../utils/puzzleLogic';
import PUZZLE_IMAGES, { getRandomPuzzleImage } from '../data/puzzleImages';

const { width: SW } = Dimensions.get('window');
const BOARD_SIZE = SW - 40;
const TILE_GAP = 2;

// Максимальное время (секунды) для расчёта бонуса очков
const MAX_TIME = { easy: 60, medium: 120, hard: 210, hardcore: 360 };
// Базовые очки
const DIFF_POINTS = { easy: 10, medium: 25, hard: 50, hardcore: 100 };

const DIFFS = [
  { key: 'easy',     label: 'Легко',    grid: 3, color: '#43A047' },
  { key: 'medium',   label: 'Средне',   grid: 4, color: '#1E88E5' },
  { key: 'hard',     label: 'Сложно',   grid: 5, color: '#FB8C00' },
  { key: 'hardcore', label: 'Хардкор',  grid: 6, color: '#E53935' },
];

const CONFETTI_COLORS = [
  '#FFD700','#FF6B6B','#4ECDC4','#45B7D1','#96CEB4',
  '#FFEAA7','#DDA0DD','#98D8C8','#F7DC6F','#BB8FCE',
];

function calcScore(diff, elapsed) {
  const base = DIFF_POINTS[diff];
  const maxT = MAX_TIME[diff];
  // multiplier: 3x если мгновенно, 1x если == maxTime, 0.5x если сильно превышено
  const ratio = Math.max(0, 1 - elapsed / maxT);
  const multiplier = 1 + ratio * 2; // 1..3
  return Math.round(base * multiplier);
}

/** Анимированная конфетти-частица */
function ConfettiParticle({ color, startX, delay }) {
  const y = useRef(new Animated.Value(-20)).current;
  const x = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const dx = (Math.random() - 0.5) * SW * 0.8;
    const fallDist = SW * 0.9 + Math.random() * SW * 0.5;
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 100, useNativeDriver: true }),
        Animated.timing(y, { toValue: fallDist, duration: 1800 + Math.random() * 600, useNativeDriver: true }),
        Animated.timing(x, { toValue: dx,       duration: 1800 + Math.random() * 600, useNativeDriver: true }),
        Animated.timing(rotate, { toValue: 8 + Math.random() * 6, duration: 2000, useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(1200),
          Animated.timing(opacity, { toValue: 0, duration: 600, useNativeDriver: true }),
        ]),
      ]).start();
    }, delay);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rot = rotate.interpolate({ inputRange: [0, 12], outputRange: ['0deg', '720deg'] });
  const size = 6 + Math.random() * 8;

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: 0,
        left: startX,
        width: size,
        height: size,
        backgroundColor: color,
        borderRadius: Math.random() > 0.5 ? size / 2 : 2,
        opacity,
        transform: [{ translateY: y }, { translateX: x }, { rotate: rot }],
      }}
    />
  );
}

/** Взрыв конфетти из центра экрана */
function Confetti() {
  const particles = useRef(
    Array.from({ length: 50 }, (_, i) => ({
      key: i,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      startX: SW * 0.1 + Math.random() * SW * 0.8,
      delay: Math.random() * 400,
    }))
  ).current;

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {particles.map((p) => (
        <ConfettiParticle key={p.key} {...p} />
      ))}
    </View>
  );
}

function fmt(s) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function PuzzleGame({ colors, user, onScoreSubmit }) {
  const [started, setStarted] = useState(false);
  const [diff, setDiff] = useState('medium');
  const [image, setImage] = useState(() => getRandomPuzzleImage(null));
  const [pickerVisible, setPickerVisible] = useState(false); // модал выбора фото

  const cfg = DIFFS.find((d) => d.key === diff);
  const G = cfg.grid;
  const tileSize = BOARD_SIZE / G;
  const innerSize = tileSize - TILE_GAP;

  const [tiles, setTiles] = useState(null);
  const [selected, setSelected] = useState(null);
  const [moves, setMoves] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [won, setWon] = useState(false);
  const [refVisible, setRefVisible] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  // Keep refs for tile state so handleTile never has stale closures
  const tilesRef = useRef(null);
  const selectedRef = useRef(null);
  const wonRef = useRef(false);
  const gridSizeRef = useRef(G);
  useEffect(() => { tilesRef.current = tiles; }, [tiles]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { wonRef.current = won; }, [won]);
  useEffect(() => { gridSizeRef.current = G; }, [G]);

  const tileScalesRef = useRef([]);
  if (tileScalesRef.current.length !== G * G) {
    tileScalesRef.current = Array.from({ length: G * G }, () => new Animated.Value(1));
  }
  const tileScales = tileScalesRef.current;

  const winAnim = useRef(new Animated.Value(0)).current;
  const timerRef = useRef(null);

  // ── Start / reset ──────────────────────────────────────────────────────────
  function startGame(nextImage) {
    clearInterval(timerRef.current);
    const gridSize = gridSizeRef.current;
    // Ensure tileScales match the grid
    if (tileScalesRef.current.length !== gridSize * gridSize) {
      tileScalesRef.current = Array.from({ length: gridSize * gridSize }, () => new Animated.Value(1));
    }
    const img = nextImage || image;
    setImage(img);
    const newTiles = shuffleTiles(gridSize);
    setTiles(newTiles);
    tilesRef.current = newTiles;
    setSelected(null);
    selectedRef.current = null;
    setMoves(0);
    setElapsed(0);
    setWon(false);
    wonRef.current = false;
    setShowConfetti(false);
    winAnim.setValue(0);
    tileScalesRef.current.forEach((a) => a.setValue(1));
    setStarted(true);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
  }

  // Restart when difficulty changes mid-game
  useEffect(() => {
    if (!started) return;
    // Rebuild tile scales for new grid size
    tileScalesRef.current = Array.from({ length: G * G }, () => new Animated.Value(1));
    clearInterval(timerRef.current);
    const newTiles = shuffleTiles(G);
    setTiles(newTiles);
    tilesRef.current = newTiles;
    setSelected(null);
    selectedRef.current = null;
    setMoves(0);
    setElapsed(0);
    setWon(false);
    wonRef.current = false;
    winAnim.setValue(0);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diff]);

  useEffect(() => () => clearInterval(timerRef.current), []);

  // ── Win ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!won) return;
    clearInterval(timerRef.current);
    Animated.spring(winAnim, { toValue: 1, friction: 6, useNativeDriver: true }).start();

    // Запускаем конфетти
    setShowConfetti(true);
    const confettiTimer = setTimeout(() => setShowConfetti(false), 3000);

    // Считаем очки с учётом времени
    const earned = calcScore(diff, elapsed);
    const totalTiles = G * G;

    if (onScoreSubmit) {
      onScoreSubmit({
        score: earned,
        total_questions: totalTiles,
        correct_answers: totalTiles,
        difficulty: diff,
        elapsed_seconds: elapsed,
        moves,
      });
    }

    return () => clearTimeout(confettiTimer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [won]);

  // ── Tap handler ───────────────────────────────────────────────────────────
  // Uses refs to always access the latest state — prevents stale closure issues
  // that could cause win detection to fail (especially on 3×3 and other grids).
  const handleTile = useCallback(
    (pos) => {
      const curTiles = tilesRef.current;
      const curSelected = selectedRef.current;
      const curWon = wonRef.current;
      const scales = tileScalesRef.current;
      if (curWon || !curTiles) return;
      if (curSelected === null) {
        setSelected(pos);
        selectedRef.current = pos;
        if (scales[pos]) Animated.spring(scales[pos], { toValue: 1.08, friction: 5, useNativeDriver: true }).start();
      } else if (curSelected === pos) {
        setSelected(null);
        selectedRef.current = null;
        if (scales[pos]) Animated.spring(scales[pos], { toValue: 1, friction: 5, useNativeDriver: true }).start();
      } else {
        // Swap
        const next = [...curTiles];
        [next[curSelected], next[pos]] = [next[pos], next[curSelected]];

        // Bounce both tiles
        [curSelected, pos].forEach((idx) => {
          if (scales[idx]) {
            Animated.sequence([
              Animated.spring(scales[idx], { toValue: 1.12, friction: 5, useNativeDriver: true }),
              Animated.spring(scales[idx], { toValue: 1, friction: 5, useNativeDriver: true }),
            ]).start();
          }
        });

        setTiles(next);
        tilesRef.current = next;
        setSelected(null);
        selectedRef.current = null;
        setMoves((m) => m + 1);
        if (isSolved(next)) {
          setWon(true);
          wonRef.current = true;
        }
      }
    },
    [], // stable callback — reads everything from refs
  );

  const correct = tiles ? countCorrect(tiles) : 0;
  const total = G * G;
  const pct = Math.round((correct / total) * 100);

  // ── Pre-start (collapsed state) ───────────────────────────────────────────
  if (!started) {
    return (
      <View style={[st.wrap, { borderTopColor: colors.border }]}>
        {/* Image preview strip */}
        <View style={[st.startCard, { backgroundColor: colors.card, borderColor: colors.primary }]}>
          <Image source={{ uri: image.url }} style={st.thumb} resizeMode="cover" />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[st.startTitle, { color: colors.text }]}>
              🧩 Пазл-игра
            </Text>
            <Text style={[st.startSub, { color: colors.textSecondary }]}>
              {image.emoji} {image.title}
            </Text>
            {/* Кнопки смены изображения */}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              <TouchableOpacity
                onPress={() => setImage(getRandomPuzzleImage(image.id))}
                style={[st.imgPickBtn, { backgroundColor: colors.border }]}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              >
                <Text style={{ fontSize: 10, color: colors.text, fontWeight: '700' }}>🔀 Случайное</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setPickerVisible(true)}
                style={[st.imgPickBtn, { backgroundColor: colors.border }]}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              >
                <Text style={{ fontSize: 10, color: colors.text, fontWeight: '700' }}>🖼 Выбрать</Text>
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity
            style={[st.startBtn, { backgroundColor: colors.primary }]}
            onPress={() => startGame()}
            activeOpacity={0.85}
          >
            <Text style={st.startBtnTxt}>Играть</Text>
          </TouchableOpacity>
        </View>

        {/* Difficulty selector */}
        <View style={st.diffRow}>
          {DIFFS.map((d) => (
            <TouchableOpacity
              key={d.key}
              onPress={() => setDiff(d.key)}
              style={[
                st.diffBtn,
                { borderColor: diff === d.key ? d.color : colors.border },
                diff === d.key && { backgroundColor: d.color + '22' },
              ]}
              activeOpacity={0.8}
            >
              <Text style={[st.diffTxt, { color: diff === d.key ? d.color : colors.textSecondary }]}>
                {d.label}
              </Text>
              <Text style={[st.diffGrid, { color: diff === d.key ? d.color : colors.textSecondary }]}>
                {d.grid}×{d.grid}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  // ── In-game ────────────────────────────────────────────────────────────────
  return (
    <View style={[st.wrap, { borderTopColor: colors.border }]}>

      {/* Header: timer + moves + progress */}
      <View style={st.gameHeader}>
        <Text style={[st.timerTxt, { color: colors.text }]}>⏱ {fmt(elapsed)}</Text>
        <View style={[st.progressTrack, { backgroundColor: colors.border }]}>
          <View style={[st.progressFill, { width: `${pct}%`, backgroundColor: cfg.color }]} />
        </View>
        <Text style={[st.movesTxt, { color: colors.textSecondary }]}>{moves} ходов</Text>
      </View>

      {/* Difficulty + image label row */}
      <View style={st.subHeader}>
        <View style={[st.diffBadge, { backgroundColor: cfg.color + '22', borderColor: cfg.color }]}>
          <Text style={[st.diffBadgeTxt, { color: cfg.color }]}>{cfg.label}  {G}×{G}</Text>
        </View>
        <Text style={[st.imageName, { color: colors.textSecondary }]}>
          {image.emoji} {image.title}
        </Text>
        {/* Кнопка просмотра референса */}
        <TouchableOpacity
          onPress={() => setRefVisible(true)}
          style={[st.refBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={{ fontSize: 10, color: colors.text, fontWeight: '700' }}>🖼 Образец</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { setStarted(false); clearInterval(timerRef.current); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Puzzle board */}
      <View style={[st.board, { width: BOARD_SIZE, height: BOARD_SIZE }]}>
        {Array.from({ length: G }, (_, row) => (
          <View key={row} style={st.tileRow}>
            {Array.from({ length: G }, (_, col) => {
              const pos = row * G + col;
              const origIdx = tiles[pos];
              const origRow = Math.floor(origIdx / G);
              const origCol = origIdx % G;
              const isSel = pos === selected;
              const isCorrectPos = tiles[pos] === pos;

              return (
                <Animated.View
                  key={pos}
                  style={{ transform: [{ scale: tileScales[pos] }] }}
                >
                  <TouchableOpacity
                    onPress={() => handleTile(pos)}
                    activeOpacity={0.85}
                    style={[
                      st.tile,
                      {
                        width: innerSize,
                        height: innerSize,
                        margin: TILE_GAP / 2,
                        borderRadius: G <= 3 ? 8 : G <= 4 ? 5 : 3,
                        borderWidth: isSel ? 2.5 : 0.8,
                        borderColor: isSel
                          ? colors.primary
                          : isCorrectPos && won
                          ? '#43A047'
                          : '#00000030',
                        overflow: 'hidden',
                      },
                    ]}
                  >
                    <Image
                      source={{ uri: image.url }}
                      style={{
                        width: BOARD_SIZE,
                        height: BOARD_SIZE,
                        position: 'absolute',
                        top: -origRow * tileSize,
                        left: -origCol * tileSize,
                      }}
                      resizeMode="cover"
                    />
                    {/* Highlight selected */}
                    {isSel && (
                      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.primary + '33' }]} />
                    )}
                  </TouchableOpacity>
                </Animated.View>
              );
            })}
          </View>
        ))}
      </View>

      {/* Конфетти оверлей */}
      {showConfetti && <Confetti />}

      {/* Win banner */}
      {won && (() => {
        const earned = calcScore(diff, elapsed);
        return (
          <Animated.View
            style={[
              st.winBanner,
              { backgroundColor: colors.card, borderColor: colors.primary },
              { opacity: winAnim, transform: [{ scale: winAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] },
            ]}
          >
            <Text style={st.winEmoji}>🏆</Text>
            <View style={{ flex: 1, marginHorizontal: 10 }}>
              <Text style={[st.winTitle, { color: colors.text }]}>Собрано!</Text>
              <Text style={[st.winSub, { color: colors.textSecondary }]}>
                {fmt(elapsed)}  •  {moves} ходов
              </Text>
              <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 15, marginTop: 3 }}>
                +{earned} pts ⚡
              </Text>
            </View>
            <View style={st.winBtns}>
              <TouchableOpacity
                onPress={() => startGame()}
                style={[st.winBtn, { backgroundColor: colors.primary }]}
                activeOpacity={0.85}
              >
                <Text style={st.winBtnTxt}>Ещё раз</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => startGame(getRandomPuzzleImage(image.id))}
                style={[st.winBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginTop: 5 }]}
                activeOpacity={0.85}
              >
                <Text style={[st.winBtnTxt, { color: colors.text }]}>Новое 🔀</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        );
      })()}

      {/* Пикер изображений */}
      <Modal
        visible={pickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerVisible(false)}
      >
        <View style={st.pickerOverlay}>
          <View style={[st.pickerSheet, { backgroundColor: colors.card }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <Text style={[st.refTitle, { flex: 1, marginBottom: 0, color: colors.text }]}>Выбери изображение</Text>
              <TouchableOpacity onPress={() => setPickerVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ fontSize: 20, color: colors.textSecondary }}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={st.pickerGrid}>
                {PUZZLE_IMAGES.map((img) => (
                  <TouchableOpacity
                    key={img.id}
                    style={[
                      st.pickerThumb,
                      image.id === img.id && { borderColor: colors.primary, borderWidth: 3 },
                    ]}
                    onPress={() => {
                      setImage(img);
                      setPickerVisible(false);
                    }}
                    activeOpacity={0.8}
                  >
                    <Image source={{ uri: img.url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                    <View style={[st.pickerLabel, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
                      <Text style={{ color: '#fff', fontSize: 8, fontWeight: '700' }} numberOfLines={1}>
                        {img.emoji} {img.title}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Референс-фото — модал с полным изображением */}
      <Modal
        visible={refVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRefVisible(false)}
      >
        <TouchableOpacity
          style={st.refOverlay}
          activeOpacity={1}
          onPress={() => setRefVisible(false)}
        >
          <View style={[st.refModal, { backgroundColor: colors.card }]}>
            <Text style={[st.refTitle, { color: colors.text }]}>
              {image.emoji} {image.title}
            </Text>
            <Image
              source={{ uri: image.url }}
              style={st.refImage}
              resizeMode="cover"
            />
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 8 }}>
              Нажмите в любом месте, чтобы закрыть
            </Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: {
    borderTopWidth: 1,
    marginTop: 10,
    paddingTop: 12,
  },

  // Pre-start
  startCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
  },
  thumb: { width: 52, height: 52, borderRadius: 10 },
  startTitle: { fontSize: 15, fontWeight: '700' },
  startSub: { fontSize: 12, marginTop: 3 },
  startBtn: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  startBtnTxt: { color: '#000', fontWeight: '800', fontSize: 13 },

  diffRow: { flexDirection: 'row', gap: 6 },
  diffBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 6,
  },
  diffTxt: { fontSize: 10, fontWeight: '700' },
  diffGrid: { fontSize: 14, fontWeight: '900' },

  // In-game header
  gameHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  timerTxt: { fontSize: 14, fontWeight: '700', minWidth: 56, fontVariant: ['tabular-nums'] },
  progressTrack: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },
  movesTxt: { fontSize: 12, minWidth: 52, textAlign: 'right' },

  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  diffBadge: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 2 },
  diffBadgeTxt: { fontSize: 10, fontWeight: '800' },
  imageName: { flex: 1, fontSize: 12 },
  refBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },

  // Board
  board: { alignSelf: 'center' },
  tileRow: { flexDirection: 'row' },
  tile: {},

  // Win banner
  winBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: 16,
    padding: 14,
    marginTop: 12,
  },
  winEmoji: { fontSize: 32 },
  winTitle: { fontSize: 16, fontWeight: '800' },
  winSub: { fontSize: 12, marginTop: 2 },
  winBtns: { alignItems: 'center' },
  winBtn: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, minWidth: 90, alignItems: 'center' },
  winBtnTxt: { fontWeight: '800', fontSize: 12, color: '#000' },

  // Кнопка смены изображения (pre-start)
  imgPickBtn: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },

  // Пикер изображений
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '75%',
  },
  pickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pickerThumb: {
    width: (SW - 72) / 3,
    height: (SW - 72) / 3,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  pickerLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 4,
    paddingVertical: 3,
  },

  // Референс-фото модал
  refOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  refModal: {
    borderRadius: 20,
    padding: 16,
    alignItems: 'center',
    width: '100%',
  },
  refTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  refImage: {
    width: SW - 80,
    height: SW - 80,
    borderRadius: 12,
  },
});
