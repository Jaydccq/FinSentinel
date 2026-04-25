import { AreaChart, Area, ResponsiveContainer } from 'recharts';

interface Props {
  data: number[];
  isUp: boolean;
  width?: number;
  height?: number;
}

export default function Sparkline({ data, isUp, width = 80, height = 24 }: Props) {
  const chartData = data.map((v, i) => ({ i, v }));
  const color = isUp ? '#22c55e' : '#ef4444';

  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill={color}
            fillOpacity={0.1}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
