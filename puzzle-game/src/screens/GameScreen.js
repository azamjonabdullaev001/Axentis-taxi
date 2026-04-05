import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { shuffleTiles, isSolved, countCorrect } from '../utils/puzzle';
import { getRandomImage } from '../data/images';

const { width: SW } = Dimensions.get('window');
const BOARD_PADDING = 16;
const BOARD_SIZE = SW - BOARD_PADDING * 2;
const TILE_GAP = 2;

const DIFFS = {
  easy:     { gridSize: 3, label: 'EASY',     colors: ['#43A047', '#2E7D32'] },
  medium:   { gridSize: 4, label: 'MEDIUM',   colors: ['#1E88E5', '#1565C0'] },
  hard:     { gridSize: 5, label: 'HARD',     colors: ['#FB8C00', '#E65100'] },
  hardcore: { gridSize: 6, label: 'HARDCORE', colors: ['#E53935', '#B71C1C'] },
};

export default function GameScreen({ route, navigation }) {
  const { difficulty, image: initialImage } = route.params;
  const cfg = DIFFS[difficulty];
  const G = cfg.gridSize;
  const tileSize = BOARD_SIZE / G;
  const innerSize = tileSize - TILE_GAP;
  const insets = useSafeAreaInsets();

  const [image, setImage] = useState(initialImage);
  const [tiles, setTiles] = useState(() => shuffleTiles(G));
  const [selected, setSelected] = useState(null); // position index, or null
  const [elapsed, setElapsed] = useState(0);
  const [moves, setMoves] = useState(0);
  const [won, setWon] = useState(false);

  // Animated values
  const winOpacity = useRef(new Animated.Value(0)).current;
  const winScale = useRef(new Animated.Value(0.8)).current;
  // Per-tile scale for swap bounce
  const tileScales = useRef(
    Array.from({ length: G * G }, () => new Animated.Value(1)),
  ).current;

  const timerRef = useRef(null);

  // ── Timer ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  // ── Win effect ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!won) return;
    clearInterval(timerRef.current);
    Animated.parallel([
      Animated.timing(winOpacity, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.spring(winScale, { toValue: 1, friction: 6, useNativeDriver: true }),
    ]).start();
  }, [won]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const fmt = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  function bounceTile(pos, toValue = 1.1) {
    Animated.sequence([
      Animated.spring(tileScales[pos], { toValue, friction: 5, useNativeDriver: true }),
      Animated.spring(tileScales[pos], { toValue: 1, friction: 5, useNativeDriver: true }),
    ]).start();
  }

  // ── Tile tap handler ───────────────────────────────────────────────────────
  const handlePress = useCallback(
    (pos) => {
      if (won) return;

      if (selected === null) {
        // Select
        setSelected(pos);
        Animated.spring(tileScales[pos], { toValue: 1.08, friction: 5, useNativeDriver: true }).start();
      } else if (selected === pos) {
        // Deselect
        setSelected(null);
        Animated.spring(tileScales[pos], { toValue: 1, friction: 5, useNativeDriver: true }).start();
      } else {
        // Swap selected ↔ pos
        const next = [...tiles];
        [next[selected], next[pos]] = [next[pos], next[selected]];

        bounceTile(selected);
        bounceTile(pos, 1.12);

        setTiles(next);
        setSelected(null);
        setMoves((m) => m + 1);

        if (isSolved(next)) setWon(true);
      }
    },
    [selected, tiles, won, tileScales],
  );

  // ── Reset / restart ────────────────────────────────────────────────────────
  function restart(nextImage) {
    clearInterval(timerRef.current);
    setTiles(shuffleTiles(G));
    setSelected(null);
    setElapsed(0);
    setMoves(0);
    setWon(false);
    winOpacity.setValue(0);
    winScale.setValue(0.8);
    tileScales.forEach((a) => a.setValue(1));
    if (nextImage) setImage(nextImage);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
  }

  const correct = countCorrect(tiles);
  const total = G * G;
  const progressPct = `${Math.round((correct / total) * 100)}%`;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <LinearGradient colors={['#0d0d1a', '#1a1a3e']} style={StyleSheet.absoluteFillObject} />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.navigate('Menu')}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.backText}>‹ Меню</Text>
        </TouchableOpacity>

        <LinearGradient colors={cfg.colors} style={styles.badge}>
          <Text style={styles.badgeText}>{cfg.label}  {G}×{G}</Text>
        </LinearGradient>

        <Text style={styles.timerText}>{fmt(elapsed)}</Text>
      </View>

      {/* ── Sub-header: progress bar ─────────────────────────────────────── */}
      <View style={styles.infoRow}>
        <Text style={styles.infoText}>
          {image.emoji}  {image.title}
        </Text>
        <Text style={styles.infoText}>
          {correct}/{total}  ✓
        </Text>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: progressPct, backgroundColor: cfg.colors[0] }]} />
      </View>

      {/* ── Board ───────────────────────────────────────────────────────── */}
      <View style={[styles.board, { width: BOARD_SIZE, height: BOARD_SIZE }]}>
        {Array.from({ length: G }, (_, row) => (
          <View key={row} style={styles.row}>
            {Array.from({ length: G }, (_, col) => {
              const pos = row * G + col;
              const origIdx = tiles[pos];
              const origRow = Math.floor(origIdx / G);
              const origCol = origIdx % G;
              const isSel = pos === selected;

              return (
                <Animated.View
                  key={pos}
                  style={{ transform: [{ scale: tileScales[pos] }] }}
                >
                  <TouchableOpacity
                    onPress={() => handlePress(pos)}
                    activeOpacity={0.9}
                    style={[
                      styles.tile,
                      {
                        width: innerSize,
                        height: innerSize,
                        margin: TILE_GAP / 2,
                        borderRadius: G <= 3 ? 8 : G <= 4 ? 5 : 3,
                        borderWidth: isSel ? 2.5 : 0.5,
                        borderColor: isSel ? '#FFD700' : '#ffffff20',
                        overflow: 'hidden',
                      },
                    ]}
                  >
                    {/* Image piece — show the correct slice of the full image */}
                    <Image
                      source={{ uri: image.url }}
                      style={{
                        width: BOARD_SIZE,
                        height: BOARD_SIZE,
                        position: 'absolute',
                        top: -origRow * tileSize,
                        left: -origCol * tileSize,
                      }}
                    />

                    {/* Selection highlight */}
                    {isSel && (
                      <View
                        style={[
                          StyleSheet.absoluteFillObject,
                          { backgroundColor: '#FFD70040' },
                        ]}
                      />
                    )}

                    {/* Win green flash */}
                    {won && (
                      <Animated.View
                        style={[
                          StyleSheet.absoluteFillObject,
                          { backgroundColor: '#00cc4435', opacity: winOpacity },
                        ]}
                      />
                    )}
                  </TouchableOpacity>
                </Animated.View>
              );
            })}
          </View>
        ))}
      </View>

      {/* ── Moves counter ───────────────────────────────────────────────── */}
      <Text style={styles.movesText}>{moves} ходов</Text>

      {/* ── Win overlay ─────────────────────────────────────────────────── */}
      {won && (
        <View style={styles.winOverlay}>
          <Animated.View
            style={[
              styles.winCard,
              { opacity: winOpacity, transform: [{ scale: winScale }] },
            ]}
          >
            <LinearGradient
              colors={['#1c1c3e', '#0d0d28']}
              style={styles.winCardInner}
            >
              <Text style={styles.winEmoji}>🏆</Text>
              <Text style={styles.winTitle}>Пазл собран!</Text>
              <Text style={styles.winSub}>{image.title}  •  {G}×{G}</Text>

              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={styles.statVal}>{fmt(elapsed)}</Text>
                  <Text style={styles.statLabel}>Время</Text>
                </View>
                <View style={[styles.stat, styles.statMid]}>
                  <Text style={styles.statVal}>{moves}</Text>
                  <Text style={styles.statLabel}>Ходов</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statVal}>{G}×{G}</Text>
                  <Text style={styles.statLabel}>Сетка</Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={() => restart()}
                style={[styles.winBtn, { backgroundColor: cfg.colors[0] }]}
                activeOpacity={0.85}
              >
                <Text style={styles.winBtnTxt}>🔄  Ещё раз</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => restart(getRandomImage(image.id))}
                style={[styles.winBtn, { backgroundColor: '#ffffff14', marginTop: 6 }]}
                activeOpacity={0.85}
              >
                <Text style={styles.winBtnTxt}>🔀  Новое фото</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => navigation.navigate('Menu')}
                style={styles.winBtn2}
                activeOpacity={0.8}
              >
                <Text style={styles.winBtn2Txt}>‹ В меню</Text>
              </TouchableOpacity>
            </LinearGradient>
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtn: { padding: 4 },
  backText: { color: '#fff', fontSize: 17, fontWeight: '500' },
  badge: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  badgeText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.8,
  },
  timerText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    minWidth: 56,
    textAlign: 'right',
  },

  // Info row
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  infoText: { color: '#ffffff66', fontSize: 12 },

  // Progress bar
  progressTrack: {
    height: 3,
    backgroundColor: '#ffffff18',
    marginHorizontal: 16,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 14,
  },
  progressFill: { height: 3, borderRadius: 2 },

  // Board
  board: { alignSelf: 'center' },
  row: { flexDirection: 'row' },
  tile: {},

  // Moves
  movesText: {
    textAlign: 'center',
    color: '#ffffff44',
    fontSize: 13,
    marginTop: 10,
  },

  // Win overlay
  winOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000aa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  winCard: {
    width: SW * 0.84,
    borderRadius: 26,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.7,
    shadowRadius: 24,
    elevation: 24,
  },
  winCardInner: {
    padding: 28,
    alignItems: 'center',
    borderRadius: 26,
    borderWidth: 1,
    borderColor: '#ffffff18',
  },
  winEmoji: { fontSize: 54, marginBottom: 8 },
  winTitle: { color: '#fff', fontSize: 28, fontWeight: '900', marginBottom: 4 },
  winSub: { color: '#ffffff77', fontSize: 13, marginBottom: 20 },

  statsRow: { flexDirection: 'row', marginBottom: 24 },
  stat: { alignItems: 'center', flex: 1 },
  statMid: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#ffffff22',
    marginHorizontal: 8,
    paddingHorizontal: 8,
  },
  statVal: { color: '#fff', fontSize: 22, fontWeight: '900' },
  statLabel: { color: '#ffffff55', fontSize: 11, marginTop: 3 },

  winBtn: {
    width: '100%',
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  winBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 16 },

  winBtn2: {
    width: '100%',
    padding: 12,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#ffffff25',
  },
  winBtn2Txt: { color: '#ffffff77', fontWeight: '600', fontSize: 14 },
});
