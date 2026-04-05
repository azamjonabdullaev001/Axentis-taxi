import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Easing,
} from 'react-native';
import questions from '../data/quizQuestions';

// Points awarded per difficulty
const DIFFICULTY_POINTS = { easy: 1, medium: 2, hard: 3, extreme: 4 };

// Session distribution: 25 questions
// 20% easy (5), 30% medium (7-8), 30% hard (7-8), 20% extreme (4-5)
const SESSION_SIZE = 25;
const DIST = { easy: 5, medium: 8, hard: 8, extreme: 4 };

// Time per difficulty (seconds)
const QUESTION_TIME = { easy: 12, medium: 10, hard: 8, extreme: 8 };

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateSession() {
  const byDifficulty = { easy: [], medium: [], hard: [], extreme: [] };
  for (const q of questions) {
    byDifficulty[q.difficulty]?.push(q);
  }
  const session = [];
  for (const [diff, count] of Object.entries(DIST)) {
    session.push(...shuffle(byDifficulty[diff]).slice(0, count));
  }
  // Order: easy → medium → hard → extreme
  const ordered = [
    ...session.filter((q) => q.difficulty === 'easy'),
    ...session.filter((q) => q.difficulty === 'medium'),
    ...session.filter((q) => q.difficulty === 'hard'),
    ...session.filter((q) => q.difficulty === 'extreme'),
  ];
  // Shuffle options for each question so correct answer position varies
  return ordered.map((q) => ({
    ...q,
    shuffledOptions: shuffle(q.options),
  }));
}

const DIFF_COLORS = {
  easy: '#43A047',
  medium: '#FB8C00',
  hard: '#E53935',
  extreme: '#7B1FA2',
};

export default function QuizGame({ colors, user, orderID, onScoreSubmit }) {
  const [sessionQuestions, setSessionQuestions] = useState(() => generateSession());
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [timeLeft, setTimeLeft] = useState(QUESTION_TIME.easy);
  const [showFeedback, setShowFeedback] = useState(false); // brief correct/wrong flash

  const timerProgress = useRef(new Animated.Value(1)).current; // 1 → 0
  const timerAnim = useRef(null);
  const feedbackAnim = useRef(new Animated.Value(0)).current;
  const scoreAnim = useRef(new Animated.Value(1)).current;
  const hasSubmittedRef = useRef(false);

  const currentQ = sessionQuestions[currentIdx];

  const moveToNext = useCallback((wasCorrect, earnedPoints) => {
    setShowFeedback(true);
    Animated.sequence([
      Animated.timing(feedbackAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.delay(350),
      Animated.timing(feedbackAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      setShowFeedback(false);
      const nextIdx = currentIdx + 1;
      if (nextIdx >= sessionQuestions.length) {
        setGameOver(true);
      } else {
        setCurrentIdx(nextIdx);
        setSelectedAnswer(null);
        const nextQ = sessionQuestions[nextIdx];
        const t = QUESTION_TIME[nextQ.difficulty] || 10;
        setTimeLeft(t);
        timerProgress.setValue(1);
        startTimer(t);
      }
    });
  }, [currentIdx, sessionQuestions, feedbackAnim, timerProgress]);

  const handleAnswer = useCallback((option) => {
    if (selectedAnswer !== null || gameOver) return;
    timerAnim.current?.stop();
    setSelectedAnswer(option);
    const isCorrect = option === currentQ.answer;
    const pts = isCorrect ? (DIFFICULTY_POINTS[currentQ.difficulty] || 1) : 0;
    if (isCorrect) {
      setScore((s) => s + pts);
      setCorrectCount((c) => c + 1);
      // Bounce score label
      Animated.sequence([
        Animated.timing(scoreAnim, { toValue: 1.35, duration: 100, useNativeDriver: true }),
        Animated.timing(scoreAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
      ]).start();
    }
    moveToNext(isCorrect, pts);
  }, [selectedAnswer, gameOver, currentQ, moveToNext, scoreAnim]);

  function startTimer(duration) {
    timerAnim.current?.stop();
    timerAnim.current = Animated.timing(timerProgress, {
      toValue: 0,
      duration: duration * 1000,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    timerAnim.current.start(({ finished }) => {
      if (finished) {
        // Time out — treat as wrong answer
        handleAnswer('__TIMEOUT__');
      }
    });
  }

  // Initialize first question timer
  useEffect(() => {
    if (!currentQ) return;
    const t = QUESTION_TIME[currentQ.difficulty] || 10;
    setTimeLeft(t);
    timerProgress.setValue(1);
    startTimer(t);
    return () => timerAnim.current?.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx]);

  // Countdown number display
  useEffect(() => {
    if (gameOver) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [currentIdx, gameOver]);

  // Submit score to backend when game finishes
  useEffect(() => {
    if (gameOver && !hasSubmittedRef.current && onScoreSubmit) {
      hasSubmittedRef.current = true;
      onScoreSubmit({
        order_id: orderID || null,
        score,
        total_questions: sessionQuestions.length,
        correct_answers: correctCount,
      });
    }
  }, [gameOver, score, correctCount, orderID, sessionQuestions.length, onScoreSubmit]);

  function handlePlayAgain() {
    hasSubmittedRef.current = false;
    const newSession = generateSession();
    setSessionQuestions(newSession);
    setCurrentIdx(0);
    setSelectedAnswer(null);
    setScore(0);
    setCorrectCount(0);
    setGameOver(false);
    setShowFeedback(false);
    const t = QUESTION_TIME[newSession[0].difficulty] || 10;
    setTimeLeft(t);
    timerProgress.setValue(1);
    setTimeout(() => startTimer(t), 50);
  }

  const s = makeStyles(colors);

  if (gameOver) {
    const pct = Math.round((correctCount / sessionQuestions.length) * 100);
    return (
      <View style={s.resultContainer}>
        <Text style={[s.resultEmoji]}>{pct >= 80 ? '🏆' : pct >= 50 ? '👍' : '🎯'}</Text>
        <Text style={[s.resultTitle, { color: colors.text }]}>Game Over!</Text>
        <Text style={[s.resultScore, { color: colors.primary }]}>{score} pts</Text>
        <Text style={[s.resultSub, { color: colors.textSecondary }]}>
          {correctCount} / {sessionQuestions.length} correct ({pct}%)
        </Text>
        <TouchableOpacity style={[s.playAgainBtn, { backgroundColor: colors.primary }]} onPress={handlePlayAgain}>
          <Text style={s.playAgainText}>Play Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!currentQ) return null;

  const diffColor = DIFF_COLORS[currentQ.difficulty] || colors.primary;
  const timerWidth = timerProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });
  const timerColor = timerProgress.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: ['#E53935', '#FB8C00', '#43A047'],
  });

  return (
    <View style={s.container}>
      {/* Header row: progress + score */}
      <View style={s.headerRow}>
        <Text style={[s.progress, { color: colors.textSecondary }]}>
          {currentIdx + 1}/{sessionQuestions.length}
        </Text>
        <View style={[s.diffBadge, { backgroundColor: diffColor + '22', borderColor: diffColor }]}>
          <Text style={[s.diffText, { color: diffColor }]}>
            {currentQ.type === 'logic' ? '🧠' : '📚'} {currentQ.difficulty}
          </Text>
        </View>
        <Animated.Text style={[s.score, { color: colors.primary, transform: [{ scale: scoreAnim }] }]}>
          {score} pts
        </Animated.Text>
      </View>

      {/* Timer bar */}
      <View style={[s.timerTrack, { backgroundColor: colors.border }]}>
        <Animated.View style={[s.timerFill, { width: timerWidth, backgroundColor: timerColor }]} />
      </View>
      <Text style={[s.timerNumber, { color: colors.textSecondary }]}>{timeLeft}s</Text>

      {/* Question */}
      <View style={[s.questionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[s.questionText, { color: colors.text }]}>{currentQ.question}</Text>
      </View>

      {/* Answer options */}
      {currentQ.shuffledOptions.map((option) => {
        const isSelected = selectedAnswer === option;
        const isCorrect = option === currentQ.answer;
        let bgColor = colors.card;
        let borderColor = colors.border;
        let textColor = colors.text;

        if (selectedAnswer !== null) {
          if (isCorrect) {
            bgColor = '#43A04722';
            borderColor = '#43A047';
            textColor = '#43A047';
          } else if (isSelected && !isCorrect) {
            bgColor = '#E5393522';
            borderColor = '#E53935';
            textColor = '#E53935';
          }
        }

        return (
          <TouchableOpacity
            key={option}
            style={[s.optionBtn, { backgroundColor: bgColor, borderColor }]}
            onPress={() => handleAnswer(option)}
            activeOpacity={0.75}
            disabled={selectedAnswer !== null}
          >
            <Text style={[s.optionText, { color: textColor }]} numberOfLines={3}>{option}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: 4,
      paddingBottom: 8,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    progress: { fontSize: 13, fontWeight: '600' },
    diffBadge: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    diffText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
    score: { fontSize: 15, fontWeight: '900' },
    timerTrack: {
      height: 5,
      borderRadius: 3,
      overflow: 'hidden',
      marginBottom: 2,
    },
    timerFill: { height: 5, borderRadius: 3 },
    timerNumber: { fontSize: 11, textAlign: 'right', marginBottom: 8 },
    questionCard: {
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      marginBottom: 10,
    },
    questionText: {
      fontSize: 14,
      fontWeight: '600',
      lineHeight: 20,
    },
    optionBtn: {
      borderWidth: 1.5,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 9,
      marginBottom: 7,
    },
    optionText: {
      fontSize: 13,
      fontWeight: '500',
      lineHeight: 17,
    },
    // Result screen
    resultContainer: {
      paddingVertical: 8,
      alignItems: 'center',
    },
    resultEmoji: { fontSize: 40, marginBottom: 6 },
    resultTitle: { fontSize: 20, fontWeight: '800', marginBottom: 4 },
    resultScore: { fontSize: 36, fontWeight: '900', marginBottom: 2 },
    resultSub: { fontSize: 14, marginBottom: 16 },
    playAgainBtn: {
      borderRadius: 12,
      paddingHorizontal: 32,
      paddingVertical: 12,
    },
    playAgainText: { color: '#000', fontWeight: '800', fontSize: 15 },
  });
}
