/**
 * @license Source-Available (Non-Commercial) - See LICENSE.md
 */

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import './CandyDrops.css';

import Candy1 from '../../public/drops/candy_1.png';
import Candy2 from '../../public/drops/candy_2.png';
import Candy3 from '../../public/drops/candy_3.png';
import Candy4 from '../../public/drops/candy_4.png';
import Candy5 from '../../public/drops/candy_5.png';

type CandyDrop = {
  id: string;
  src: string;
  left: number;
  size: number;
  duration: number;
  delay: number;
  drift: number;
  rotate: number;
  opacity: number;
};

const CANDIES = [Candy1, Candy2, Candy3, Candy4, Candy5];
const BASE_CONTENT_WIDTH = 1550;

const getSideWidth = () => {
  if (typeof window === 'undefined') return 0;
  return Math.max(0, (window.innerWidth - BASE_CONTENT_WIDTH) / 2);
};

const createDrops = (seed: string, count: number, zoneWidth: number): CandyDrop[] => {
  if (zoneWidth <= 0) return [];
  const drops: CandyDrop[] = [];
  const safePadding = 8;
  const usableWidth = Math.max(0, zoneWidth - safePadding * 2);
  const maxCount = Math.max(2, Math.min(count, Math.floor(usableWidth / 40)));

  for (let i = 0; i < maxCount; i += 1) {
    const base = Math.random();
    const size = 26 + Math.random() * 26;
    const maxTravel = Math.max(0, usableWidth - size);
    const drift = Math.min(16 + Math.random() * 10, Math.max(0, maxTravel / 2.6));
    const maxLeft = Math.max(0, maxTravel - drift * 2.2);
    const left = safePadding + (maxLeft > 0 ? Math.random() * maxLeft : 0);

    drops.push({
      id: `${seed}-${i}`,
      src: CANDIES[i % CANDIES.length],
      left,
      size,
      duration: 10 + Math.random() * 8,
      delay: Math.random() * 6,
      drift,
      rotate: Math.random() * 18,
      opacity: 0.7 + base * 0.3,
    });
  }
  return drops;
};

export function CandyDrops() {
  const [zoneWidth, setZoneWidth] = useState(getSideWidth);

  useEffect(() => {
    const handleResize = () => setZoneWidth(getSideWidth());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const leftDrops = useMemo(() => createDrops('left', 10, zoneWidth), [zoneWidth]);
  const rightDrops = useMemo(() => createDrops('right', 10, zoneWidth), [zoneWidth]);

  return (
    <div className="candy-drops">
      <div className="candy-drop-zone left" style={{ width: zoneWidth }}>
        {leftDrops.map((drop) => (
          <motion.img
            key={drop.id}
            src={drop.src}
            alt=""
            className="candy-drop"
            draggable={false}
            style={{
              left: `${drop.left}px`,
              width: `${drop.size}px`,
              opacity: drop.opacity,
            }}
            initial={{ y: -120 }}
            animate={{
              y: '110vh',
              x: [0, drop.drift * 1.4, drop.drift * 2.2],
              rotate: 360,
            }}
            transition={{
              duration: drop.duration,
              delay: drop.delay,
              ease: 'linear',
              repeat: Infinity,
            }}
          />
        ))}
      </div>

      <div className="candy-drop-zone right" style={{ width: zoneWidth }}>
        {rightDrops.map((drop) => (
          <motion.img
            key={drop.id}
            src={drop.src}
            alt=""
            className="candy-drop"
            draggable={false}
            style={{
              left: `${drop.left}px`,
              width: `${drop.size}px`,
              opacity: drop.opacity,
            }}
            initial={{ y: -140 }}
            animate={{
              y: '110vh',
              x: [0, -drop.drift * 1.4, -drop.drift * 2.2],
              rotate: -360,
            }}
            transition={{
              duration: drop.duration + 1,
              delay: drop.delay * 0.8,
              ease: 'linear',
              repeat: Infinity,
            }}
          />
        ))}
      </div>
    </div>
  );
}
