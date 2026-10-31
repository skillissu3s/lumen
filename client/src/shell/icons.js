// Icons by name — boards, calendars, idea boards and plugin manifests store an
// icon as plain text ("rocket"), never an emoji.
import {
  Activity, Archive, Award, BarChart3, Bell, Book, BookOpen, Bookmark, Bot, Brain, Briefcase, Bug, Building2, Calendar, Camera, ChartBar,
  CircleDot, ClipboardList, Clock, Cloud, Code, Coffee, Compass, Cpu, CreditCard, Database, Dumbbell, Feather, FileText, Film, Flag, Flame,
  FlaskConical, Folder, Gamepad2, Gift, Globe, GraduationCap, Hammer, Heart, Home, Inbox, Kanban, Key, Landmark, Laptop, Layers, Layout,
  Leaf, Lightbulb, ListChecks, Mail, Map, Megaphone, MessageSquare, Mic, Mountain, Music, NotebookPen, Package, Palette, PenTool, Phone, PiggyBank,
  Plane, Puzzle, Rocket, Scale, School, Search, Settings, Shield, ShoppingCart, Sparkles, Sprout, Star, Stethoscope, Sun, Target, Tent, Timer,
  Trees, Trophy, Truck, Users, Utensils, Wallet, Wrench, Zap,
} from 'lucide-react'

export const ICONS = {
  inbox: Inbox, kanban: Kanban, 'list-checks': ListChecks, 'clipboard-list': ClipboardList, target: Target, rocket: Rocket, flag: Flag, star: Star,
  briefcase: Briefcase, building: Building2, home: Home, users: Users, heart: Heart, sparkles: Sparkles, lightbulb: Lightbulb, brain: Brain,
  book: Book, 'book-open': BookOpen, 'notebook-pen': NotebookPen, 'file-text': FileText, feather: Feather, 'pen-tool': PenTool, palette: Palette, camera: Camera,
  film: Film, music: Music, mic: Mic, megaphone: Megaphone, mail: Mail, 'message-square': MessageSquare, phone: Phone, bell: Bell,
  code: Code, bug: Bug, cpu: Cpu, laptop: Laptop, database: Database, cloud: Cloud, globe: Globe, layers: Layers,
  layout: Layout, package: Package, truck: Truck, wrench: Wrench, hammer: Hammer, settings: Settings, shield: Shield, key: Key,
  wallet: Wallet, 'credit-card': CreditCard, 'piggy-bank': PiggyBank, landmark: Landmark, scale: Scale, 'chart-bar': ChartBar, 'bar-chart': BarChart3, activity: Activity,
  'graduation-cap': GraduationCap, school: School, 'flask-conical': FlaskConical, stethoscope: Stethoscope, dumbbell: Dumbbell, utensils: Utensils, coffee: Coffee, 'shopping-cart': ShoppingCart,
  plane: Plane, map: Map, compass: Compass, mountain: Mountain, tent: Tent, trees: Trees, leaf: Leaf, sprout: Sprout,
  sun: Sun, zap: Zap, flame: Flame, timer: Timer, clock: Clock, calendar: Calendar, gift: Gift, trophy: Trophy,
  award: Award, gamepad: Gamepad2, puzzle: Puzzle, bot: Bot, search: Search, bookmark: Bookmark, archive: Archive, folder: Folder,
  'circle-dot': CircleDot,
}

export const ICON_NAMES = Object.keys(ICONS)

/** The icon component for a name (an unknown or emoji value falls back) */
export const iconByName = (name, fallback = Puzzle) => ICONS[String(name || '').toLowerCase()] || fallback
