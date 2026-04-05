import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Dimensions,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IMAGES, getRandomImage } from '../data/images';

const { width: SW } = Dimensions.get('window');
const PREVIEW_SIZE = SW - 48;

const DIFFICULTIES = [
  {
    key: 'easy',
    label: 'EASY',
    grid: '3×3',
    gridN: 3,
    desc: 'Для начинающих',
    colors: ['#43A047', '#1B5E20'],
    emoji: '🟢',
  },
  {
    key: 'medium',
    label: 'MEDIUM',
    grid: '4×4',
    gridN: 4,
    desc: 'Средний уровень',
    colors: ['#1E88E5', '#0D47A1'],
    emoji: '🔵',
  },
  {
    key: 'hard',
    label: 'HARD',
    grid: '5×5',
    gridN: 5,
    desc: 'Сложно',
    colors: ['#FB8C00', '#E65100'],
    emoji: '🟠',
  },
  {
    key: 'hardcore',
    label: 'HARDCORE',
    grid: '6×6',
    gridN: 6,
    desc: 'Экстрим!',
    colors: ['#E53935', '#B71C1C'],
    emoji: '🔴',
  },
];

export default function MenuScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [image, setImage] = useState(
    () => IMAGES[Math.floor(Math.random() * IMAGES.length)],
  );
  const [diff, setDiff] = useState('medium');
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const selDiff = DIFFICULTIES.find((d) => d.key === diff);

  function cycleImage() {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.88, duration: 100, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 5, useNativeDriver: true }),
    ]).start();
    setImage((prev) => getRandomImage(prev.id));
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <LinearGradient
        colors={['#0d0d1a', '#1a1a3e', '#0d0d1a']}
        style={StyleSheet.absoluteFillObject}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Title */}
        <Text style={styles.title}>🧩 PuzzleMaster</Text>
        <Text style={styles.subtitle}>Собери изображение из кусочков</Text>

        {/* Image preview */}
        <Animated.View
          style={[styles.previewWrap, { transform: [{ scale: scaleAnim }] }]}
        >
          <Image
            source={{ uri: image.url }}
            style={styles.preview}
            resizeMode="cover"
          />
          <LinearGradient
            colors={['transparent', 'transparent', '#00000099']}
            style={styles.previewOverlay}
          >
            <Text style={styles.previewTitle}>
              {image.emoji}  {image.title}
            </Text>
            <Text style={styles.previewCat}>{image.category}</Text>
          </LinearGradient>

          <TouchableOpacity style={styles.cycleBtn} onPress={cycleImage} activeOpacity={0.8}>
            <Text style={styles.cycleTxt}>🔀 Другое фото</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Difficulty */}
        <Text style={styles.sectionLabel}>СЛОЖНОСТЬ</Text>
        <View style={styles.cardsRow}>
          {DIFFICULTIES.map((d) => {
            const active = diff === d.key;
            return (
              <TouchableOpacity
                key={d.key}
                onPress={() => setDiff(d.key)}
                activeOpacity={0.8}
                style={[styles.diffCard, active && styles.diffCardActive]}
              >
                {active ? (
                  <LinearGradient colors={d.colors} style={styles.diffCardContent}>
                    <Text style={styles.cardEmoji}>{d.emoji}</Text>
                    <Text style={styles.cardLabel}>{d.label}</Text>
                    <Text style={styles.cardGridSize}>{d.grid}</Text>
                    <Text style={styles.cardDesc}>{d.desc}</Text>
                  </LinearGradient>
                ) : (
                  <View style={styles.diffCardContent}>
                    <Text style={styles.cardEmoji}>{d.emoji}</Text>
                    <Text style={[styles.cardLabel, { color: '#ffffff66' }]}>{d.label}</Text>
                    <Text style={[styles.cardGridSize, { color: '#ffffff44' }]}>{d.grid}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Start button */}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => navigation.navigate('Game', { difficulty: diff, image })}
          style={styles.startWrap}
        >
          <LinearGradient colors={selDiff.colors} style={styles.startBtn}>
            <Text style={styles.startTxt}>
              НАЧАТЬ  {selDiff.grid}
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Image gallery strip */}
        <Text style={styles.sectionLabel}>ВСЕ ИЗОБРАЖЕНИЯ</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.galleryScroll}>
          {IMAGES.map((img) => (
            <TouchableOpacity
              key={img.id}
              onPress={() => setImage(img)}
              activeOpacity={0.8}
              style={[
                styles.galleryThumb,
                img.id === image.id && styles.galleryThumbActive,
              ]}
            >
              <Image source={{ uri: img.url }} style={styles.galleryImg} resizeMode="cover" />
              {img.id === image.id && (
                <View style={styles.galleryCheckCircle}>
                  <Text style={{ fontSize: 10, color: '#fff' }}>✓</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={{ height: insets.bottom + 16 }} />
      </ScrollView>
    </View>
  );
}

const CARD_W = (SW - 48 - 10) / 2; // 2 per row, 10px gap between

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 24, paddingBottom: 16 },

  title: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  subtitle: {
    color: '#ffffff55',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 22,
  },

  // Preview
  previewWrap: {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
    borderRadius: 20,
    overflow: 'hidden',
    alignSelf: 'center',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 20,
  },
  preview: { width: PREVIEW_SIZE, height: PREVIEW_SIZE },
  previewOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  previewTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  previewCat: { color: '#ffffffaa', fontSize: 12, marginTop: 2 },
  cycleBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: '#00000077',
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#ffffff33',
  },
  cycleTxt: { color: '#fff', fontSize: 12, fontWeight: '600' },

  // Section label
  sectionLabel: {
    color: '#ffffff44',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 12,
    textTransform: 'uppercase',
  },

  // Difficulty cards
  cardsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  diffCard: {
    width: CARD_W,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#ffffff18',
    backgroundColor: '#ffffff08',
  },
  diffCardActive: {
    borderColor: 'transparent',
    elevation: 10,
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  diffCardContent: {
    padding: 14,
    alignItems: 'center',
    minHeight: 100,
    justifyContent: 'center',
  },
  cardEmoji: { fontSize: 26, marginBottom: 6 },
  cardLabel: { color: '#fff', fontWeight: '800', fontSize: 11, letterSpacing: 1 },
  cardGridSize: { color: '#ffffffcc', fontSize: 22, fontWeight: '900', marginTop: 4 },
  cardDesc: { color: '#ffffffbb', fontSize: 10, marginTop: 4, textAlign: 'center' },

  // Start button
  startWrap: {
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
  },
  startBtn: { padding: 18, alignItems: 'center', borderRadius: 18 },
  startTxt: { color: '#fff', fontSize: 17, fontWeight: '900', letterSpacing: 2 },

  // Gallery strip
  galleryScroll: { marginBottom: 8 },
  galleryThumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
    overflow: 'hidden',
    marginRight: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  galleryThumbActive: {
    borderColor: '#FFD700',
  },
  galleryImg: { width: 60, height: 60 },
  galleryCheckCircle: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FFD700',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
