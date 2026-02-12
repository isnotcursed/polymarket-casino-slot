/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { AnimatePresence, motion, useAnimate, stagger} from 'motion/react';
import type { SpinResult, WinningCluster } from '../../core/domain/types';
import SlotIMG from "@/public/slot.png"
import LogoIMG from "@/public/logo.png"
import BearYIMG from "@/public/mini/bear_yellow.png"
import BearPIMG from "@/public/mini/bear_purple.png"
import BearRIMG from "@/public/mini/bear_red.png"
import CandyGIMG from "@/public/mini/candy_green.png"
import CandyPIMG from "@/public/mini/candy_purple.png"
import CandyRIMG from "@/public/mini/candy_red.png"
import Drop1 from "@/public/drops/candy_1.png"
import Drop2 from "@/public/drops/candy_2.png"
import Drop3 from "@/public/drops/candy_3.png"
import Drop4 from "@/public/drops/candy_4.png"
import Drop5 from "@/public/drops/candy_5.png"
import './SlotMachine.css';

interface SlotMachineProps {
  isSpinning: boolean;
  result: SpinResult | null;
  onSettled?: (result: SpinResult | null) => void;
}

export const SLOT_SYMBOLS: Record<string, string> = {
  bear_yellow: BearYIMG,
  bear_purple: BearPIMG,
  bear_red: BearRIMG,
  candy_green: CandyGIMG,
  candy_purple: CandyPIMG,
  candy_red: CandyRIMG,
};

type AnimationPhase = 'idle' | 'initial-drop' | 'spinning' | 'stopping' | 'settled';
type SlotCell = { id: string; symbol: string; spawned?: boolean };
type SlotGrid = Array<Array<SlotCell | null>>;
type CandyBurst = {
  id: string;
  x: number;
  y: number;
  pieces: Array<{
    id: string;
    src: string;
    x: number;
    y: number;
    size: number;
    rotate: number;
    delay: number;
    duration: number;
  }>;
};
let cellCounter = 0;
let burstCounter = 0;
const BURST_CANDIES = [Drop1, Drop2, Drop3, Drop4, Drop5];

export function SlotMachine({ isSpinning, result, onSettled }: SlotMachineProps) {
  const [displaySymbols, setDisplaySymbols] = useState<SlotGrid>(() => createRandomGrid());
  const [animationPhase, setAnimationPhase] = useState<AnimationPhase>('idle');
  const [scope, animate] = useAnimate();
  const slotContainerRef = useRef<HTMLDivElement | null>(null);
  const [bursts, setBursts] = useState<CandyBurst[]>([]);
  const spinLoopPromisesRef = useRef<Array<Promise<void>>>([]);
  const isSpinningRef = useRef(false);
  const [activeCluster, setActiveCluster] = useState<WinningCluster | null>(null);
  const [explodedPositions, setExplodedPositions] = useState<Set<string>>(new Set());
  const collapsedGridRef = useRef<SlotGrid | null>(null);
  const clusterTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const isClusterSequenceRunningRef = useRef(false);

  useEffect(() => {
    if (isSpinning && !isSpinningRef.current) {
      isSpinningRef.current = true;
      startSpinSequence();
    }

    if (!isSpinning && result && isSpinningRef.current) {
      isSpinningRef.current = false;
      stopSpinSequence(result);
    }

    return () => {
      clearClusterTimers();
    };
  }, [isSpinning, result]);

  const startSpinSequence = async () => {
    setExplodedPositions(new Set());
    setActiveCluster(null);

    setAnimationPhase('initial-drop');

    await animate(
        '.slot-reel',
        {
          y: ['0%', '110%'],
          opacity: [1, 0.85, 0.2],
          filter: ['blur(0px)', 'blur(2px)', 'blur(6px)']
        },
        {
          duration: 0.45,
          ease: 'easeIn',
          delay: stagger(0.05)
        }
    );

    setAnimationPhase('spinning');

    const reels = document.querySelectorAll('.slot-reel');
    spinLoopPromisesRef.current = [];

    reels.forEach((reel, index) => {
      const loop = async () => {
        const reelElement = reel as HTMLElement;
        while (isSpinningRef.current) {
          await animate(
              reelElement,
              {
                y: ['-120%', '120%'],
                opacity: [0, 1, 1, 0],
                filter: ['blur(6px)', 'blur(0px)', 'blur(6px)']
              },
              {
                duration: 0.55 + index * 0.05,
                ease: 'linear'
              }
          );
          if (!isSpinningRef.current) {
            break;
          }
          setDisplaySymbols(prev => {
            const newGrid = [...prev];
            newGrid[index] = createRandomReel();
            return newGrid;
          });
          await new Promise(requestAnimationFrame);
        }
      };

      spinLoopPromisesRef.current.push(loop());
    });
  };

  const stopSpinSequence = async (spinResult: SpinResult) => {
    isSpinningRef.current = false;

    await Promise.all(spinLoopPromisesRef.current);
    spinLoopPromisesRef.current = [];

    setAnimationPhase('stopping');

    setDisplaySymbols(buildGridFromSymbols(spinResult.symbols));

    await new Promise(requestAnimationFrame);

    await animate(
        '.slot-reel',
        {
          y: ['-120%', '0%'],
          opacity: [0, 1],
          filter: ['blur(10px)', 'blur(0px)']
        },
        {
          type: 'spring',
          stiffness: 240,
          damping: 20,
          duration: 0.55,
          delay: stagger(0.08)
        }
    );

    setAnimationPhase('settled');
    onSettled?.(spinResult);
  };

  useEffect(() => {
    if (animationPhase !== 'settled' || !result || !result.clusters || result.clusters.length === 0) {
      clearClusterTimers();
      setActiveCluster(null);
      setExplodedPositions(new Set());
      isClusterSequenceRunningRef.current = false;
      return;
    }

    if (isClusterSequenceRunningRef.current) {
      return;
    }
    isClusterSequenceRunningRef.current = true;

    const runSequence = async () => {
      setExplodedPositions(new Set());
      const allPositions = new Set<string>();
      for (const cluster of result.clusters ?? []) {
        setActiveCluster(cluster);
        await sleep(550);
        setActiveCluster(null);
        await sleep(180);
        cluster.positions.forEach((pos) => allPositions.add(`${pos.col}-${pos.row}`));
      }
      if (allPositions.size > 0) {
        setExplodedPositions(allPositions);
        await sleep(450);
        setDisplaySymbols((prev) => {
          const collapsed = collapseGrid(prev, allPositions);
          collapsedGridRef.current = collapsed;
          return collapsed;
        });
        setExplodedPositions(new Set());
        await new Promise(requestAnimationFrame);
        const collapsed = collapsedGridRef.current;
        if (collapsed) {
          setDisplaySymbols(() => fillGridWithoutClusters(collapsed));
        }
        collapsedGridRef.current = null;
      }
      isClusterSequenceRunningRef.current = false;
    };

    runSequence();

    return () => {
      isClusterSequenceRunningRef.current = false;
      clearClusterTimers();
      setActiveCluster(null);
    };
  }, [animationPhase, result]);

  const sleep = (ms: number) => new Promise<void>(resolve => {
    const id = setTimeout(resolve, ms);
    clusterTimersRef.current.push(id);
  });

  const clearClusterTimers = () => {
    clusterTimersRef.current.forEach(clearTimeout);
    clusterTimersRef.current = [];
  };

  const canHover = animationPhase !== 'spinning';
  const shouldBlur = animationPhase === 'spinning' || animationPhase === 'initial-drop' || animationPhase === 'stopping';
  const activePositions = useMemo(() => {
    if (!activeCluster) return new Set<string>();
    return new Set(activeCluster.positions.map(p => `${p.col}-${p.row}`));
  }, [activeCluster]);

  const handleSymbolClick = (event: MouseEvent<HTMLSpanElement>) => {
    const container = slotContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const id = `burst-${burstCounter++}`;

    const pieces = Array.from({ length: 7 }).map((_, index) => {
      const angle = -120 + Math.random() * 80;
      const distance = 40 + Math.random() * 60;
      const rad = (angle * Math.PI) / 180;
      return {
        id: `${id}-${index}`,
        src: BURST_CANDIES[index % BURST_CANDIES.length],
        x: Math.cos(rad) * distance,
        y: Math.sin(rad) * distance,
        size: 20 + Math.random() * 16,
        rotate: -140 + Math.random() * 280,
        delay: Math.random() * 0.1,
        duration: 0.7 + Math.random() * 0.35,
      };
    });

    setBursts((prev) => [...prev, { id, x, y, pieces }]);
    window.setTimeout(() => {
      setBursts((prev) => prev.filter((burst) => burst.id !== id));
    }, 1200);
  };

  return (
      <div className="slot-machine" ref={scope}>
        <div className="slot-frame">
          <div className="slot-container" ref={slotContainerRef}>
            <div className="slot-effects">
              <AnimatePresence>
                {bursts.map((burst) => (
                  <div key={burst.id} className="slot-burst" style={{ left: burst.x, top: burst.y }}>
                    {burst.pieces.map((piece) => (
                      <motion.img
                        key={piece.id}
                        src={piece.src}
                        alt=""
                        className="slot-burst-candy"
                        draggable={false}
                        style={{ width: piece.size, height: piece.size }}
                        initial={{ x: 0, y: 0, scale: 0.5, opacity: 0 }}
                        animate={{
                          x: piece.x,
                          y: [0, piece.y, piece.y + 12],
                          scale: [0.5, 1, 0.9],
                          opacity: [0, 1, 0],
                          rotate: piece.rotate,
                        }}
                        transition={{
                          duration: piece.duration,
                          delay: piece.delay,
                          ease: 'easeOut',
                        }}
                      />
                    ))}
                  </div>
                ))}
              </AnimatePresence>
            </div>
            {displaySymbols.map((reel, reelIndex) => (
                <Fragment key={reelIndex}>
                  <motion.div
                      className="slot-reel"
                      style={{
                        filter: shouldBlur ? 'blur(4px)' : 'blur(0px)'
                      }}
                  >
                    {reel.map((cell, symbolIndex) => (
                        (() => {
                          const posKey = `${reelIndex}-${symbolIndex}`;
                          if (!cell) {
                            return (
                              <span key={`empty-${posKey}`} className="slot-symbol slot-empty" />
                            );
                          }
                          const isHighlighted = activePositions.has(posKey);
                          const isDimmed = activePositions.size > 0 && !isHighlighted;
                          const isExploded = animationPhase === 'settled' && explodedPositions.has(posKey);
                          const isSpawned = Boolean(cell.spawned);
                          return (
                        <motion.span
                            key={cell.id}
                            className={`slot-symbol ${isHighlighted && !isExploded ? 'symbol-highlight' : ''} ${isDimmed && !isExploded ? 'symbol-dimmed' : ''}`}
                            layout
                            onClick={handleSymbolClick}
                            initial={isSpawned ? { y: -90, opacity: 1 } : false}
                            animate={
                              isExploded
                                ? {
                                  scale: [1, 1.15, 0.2],
                                  opacity: [1, 1, 0],
                                  rotate: [0, 4, -6],
                                  y: 0
                                }
                                : {
                                  scale: 1,
                                  opacity: 1,
                                  rotate: 0,
                                  y: 0
                                }
                            }
                            transition={isExploded ? { duration: 0.45, ease: 'easeOut' } : { duration: 0.25, type: 'spring', stiffness: 260, damping: 22 }}
                            whileHover={canHover && !isExploded ? {
                              scale: 1.1,
                              rotate: 3,
                              transition: {
                                type: "spring",
                                stiffness: 300,
                                damping: 12
                              }
                            } : {}}
                        >
                            <motion.img
                                src={SLOT_SYMBOLS[cell.symbol]}
                                alt={cell.symbol}
                                className="symbol-image"
                                draggable={false}
                                animate={
                                  animationPhase === 'spinning'
                                      ? {
                                        scale: [1, 0.95, 1.05, 1],
                                        rotate: [-2, 2, -2, 0]
                                      }
                                    : isHighlighted
                                        ? { scale: 1.12, rotate: 4 }
                                        : {}
                                }
                                transition={
                                  animationPhase === 'spinning'
                                      ? {
                                        duration: 0.35,
                                        repeat: Infinity,
                                        ease: "easeInOut"
                                      }
                                    : isHighlighted
                                        ? {
                                          type: 'spring',
                                          stiffness: 260,
                                          damping: 16
                                        }
                                        : {}
                                }
                            />
                        </motion.span>
                          );
                        })()
                    ))}
                  </motion.div>
                  {reelIndex < displaySymbols.length - 1 && <div className="slot-hr"></div>}
                </Fragment>
            ))}
          </div>

          <div className="slot-image-overlay">
            <img
                className="img-logo"
                src={LogoIMG}
                alt="logo"
                draggable={false}
            />
            <img className="img-bg" src={SlotIMG} alt="slot" draggable={false} />
          </div>
        </div>
      </div>
  );
}

function createRandomGrid(): SlotGrid {
  const grid: SlotCell[][] = [];

  for (let i = 0; i < 7; i++) {
    grid.push(createRandomReel());
  }

  return grid;
}

function createRandomReel(): SlotCell[] {
  const reel: SlotCell[] = [];

  for (let j = 0; j < 7; j++) {
    reel.push(makeCell(getRandomSymbol()));
  }

  return reel;
}

function makeCell(symbol: string, spawned: boolean = false): SlotCell {
  return { id: `cell_${cellCounter++}`, symbol, spawned };
}

function getRandomSymbol(): string {
  const symbols = Object.keys(SLOT_SYMBOLS);
  const randomSymbol = symbols[Math.floor(Math.random() * symbols.length)];
  if (!randomSymbol) throw new Error('No symbol found!');
  return randomSymbol;
}

function buildGridFromSymbols(symbols: string[][]): SlotGrid {
  return symbols.map((reel) => reel.map((symbol) => makeCell(symbol)));
}

function collapseGrid(
  grid: SlotGrid,
  explodedPositions: Set<string>
): SlotGrid {
  const reelCount = grid.length;
  const rowCount = grid[0]?.length ?? 0;
  if (reelCount === 0 || rowCount === 0) return grid;

  return grid.map((reel, colIndex) => {
    const remaining = reel.filter((_cell, rowIndex) => !explodedPositions.has(`${colIndex}-${rowIndex}`));
    const missing = rowCount - remaining.length;
    const blanks = Array.from({ length: missing }, () => null);
    return [...blanks, ...remaining];
  });
}

function fillGridWithoutClusters(grid: SlotGrid): SlotGrid {
  const reelCount = grid.length;
  const rowCount = grid[0]?.length ?? 0;
  if (reelCount === 0 || rowCount === 0) return grid;

  const attemptFill = (): SlotGrid =>
    grid.map((reel) => {
      const filled: Array<SlotCell | null> = [];
      reel.forEach((cell) => {
        if (cell) {
          filled.push(cell);
        } else {
          filled.push(makeCell(getRandomSymbol(), true));
        }
      });
      return filled;
    });

  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = attemptFill();
    if (!hasWinningClusters(candidate)) return candidate;
  }
  return attemptFill();
}

function hasWinningClusters(grid: SlotGrid): boolean {
  const cols = grid.length;
  const rows = grid[0]?.length ?? 0;
  if (cols === 0 || rows === 0) return false;

  const visited = new Set<string>();
  const directions: Array<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const key = `${col}-${row}`;
      if (visited.has(key)) continue;
      const symbol = grid[col]?.[row]?.symbol;
      if (!symbol) continue;

      const stack: Array<[number, number]> = [[col, row]];
      const cluster: Array<[number, number]> = [];
      visited.add(key);

      while (stack.length > 0) {
        const [c, r] = stack.pop() as [number, number];
        cluster.push([c, r]);
        for (const [dc, dr] of directions) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
          const nKey = `${nc}-${nr}`;
          if (visited.has(nKey)) continue;
          if (grid[nc]?.[nr]?.symbol !== symbol) continue;
          visited.add(nKey);
          stack.push([nc, nr]);
        }
      }

      if (cluster.length >= 5) {
        return true;
      }
    }
  }
  return false;
}
