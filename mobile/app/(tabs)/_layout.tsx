import { Tabs } from 'expo-router';
import { LayoutGrid, Briefcase, Target, BarChart3, MoreHorizontal } from 'lucide-react-native';

const TEAL = '#2DD4BF';
const MUTED = '#5A6B87';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: TEAL,
        tabBarInactiveTintColor: MUTED,
        tabBarStyle: {
          backgroundColor: '#0B1220',
          borderTopColor: '#24334F',
          borderTopWidth: 1,
          height: 62,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: '#0B1220' },
      }}
    >
      <Tabs.Screen
        name="overview"
        options={{ title: 'Overview', tabBarIcon: ({ color, size }) => <LayoutGrid color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="holdings"
        options={{ title: 'Holdings', tabBarIcon: ({ color, size }) => <Briefcase color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="rebalance"
        options={{ title: 'Rebalance', tabBarIcon: ({ color, size }) => <Target color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="insights"
        options={{ title: 'Insights', tabBarIcon: ({ color, size }) => <BarChart3 color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: ({ color, size }) => <MoreHorizontal color={color} size={size} /> }}
      />
    </Tabs>
  );
}
