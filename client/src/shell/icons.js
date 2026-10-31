// Lucide icons by name, for plugin manifests (which name their icon as text).
import { Activity, Book, Bot, Brain, Briefcase, Calendar, ChartBar, Clock, Coffee, Compass, Dumbbell, Flame, Flag, Gauge, Globe, Heart, Leaf, ListChecks, Music, NotebookPen, Puzzle, Rocket, Sparkles, Star, Target, Timer, Trees, Trophy, Zap } from 'lucide-react'

const ICONS = { activity: Activity, book: Book, bot: Bot, brain: Brain, briefcase: Briefcase, calendar: Calendar, 'chart-bar': ChartBar, clock: Clock, coffee: Coffee, compass: Compass, dumbbell: Dumbbell, flame: Flame, flag: Flag, gauge: Gauge, globe: Globe, heart: Heart, leaf: Leaf, 'list-checks': ListChecks, music: Music, 'notebook-pen': NotebookPen, puzzle: Puzzle, rocket: Rocket, sparkles: Sparkles, star: Star, target: Target, timer: Timer, trees: Trees, trophy: Trophy, zap: Zap }

export const iconByName = (name) => ICONS[String(name || '').toLowerCase()] || Puzzle
