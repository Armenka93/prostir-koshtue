export type PropertyType = 'Офіс' | 'Рітейл' | 'Склад' | 'Кафе/Ресторан' | 'Салон' | 'Шоурум' | 'Гнучкий простір';

export interface Listing {
  id: number;
  title: string;
  type: PropertyType;
  price: number;
  area: number;
  floor: number;
  totalFloors: number;
  district: string;
  address: string;
  condition: string;
  parking: boolean;
  separateEntrance: boolean;
  description: string;
  images: string[];
  features: string[];
  isNew?: boolean;
  isPopular?: boolean;
  isFeatured?: boolean;
}

export const listings: Listing[] = [
  {
    id: 1,
    title: 'Офіс з видом на море, Приморський',
    type: 'Офіс',
    price: 28000,
    area: 145,
    floor: 5,
    totalFloors: 9,
    district: 'Приморський',
    address: 'вул. Дерибасівська, 18, Одеса',
    condition: 'Євроремонт',
    parking: true,
    separateEntrance: true,
    description: 'Представницький офіс у серці Одеси. Відкрите планування, великі вікна з видом на море та Приморський бульвар. Ідеально для IT-компаній та консалтингових фірм.',
    images: [
      'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80',
      'https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=800&q=80',
    ],
    features: ['Паркінг', 'Окремий вхід', 'Ліфт', 'Кондиціонер', 'Охорона'],
    isPopular: true,
    isFeatured: true,
  },
  {
    id: 2,
    title: 'Торгова площа в ТРЦ "Європа"',
    type: 'Рітейл',
    price: 24000,
    area: 82,
    floor: 2,
    totalFloors: 3,
    district: 'Київський',
    address: 'просп. Академіка Глушка, 11, Одеса',
    condition: 'Shell & Core',
    parking: true,
    separateEntrance: false,
    description: 'Торгова площа у прохідному торговому центрі на Таїрова. Висока прохідність, зручне розташування біля метро.',
    images: [
      'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&q=80',
      'https://images.unsplash.com/photo-1555529771-122f4aac0ae4?w=800&q=80',
    ],
    features: ['Великий трафік', 'Паркінг', 'Вантажний ліфт', 'Відеоспостереження'],
    isPopular: true,
  },
  {
    id: 3,
    title: 'Склад з пандусом, Пересипь',
    type: 'Склад',
    price: 15000,
    area: 380,
    floor: 1,
    totalFloors: 1,
    district: 'Суворовський',
    address: 'вул. Хімічна, 7, Одеса',
    condition: 'Задовільний',
    parking: true,
    separateEntrance: true,
    description: 'Просторий склад з виїздом на об\'їзну дорогу. Пандус для вантажних автомобілів, охорона 24/7. Зручна логістика — поруч Одеський порт.',
    images: [
      'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=800&q=80',
      'https://images.unsplash.com/photo-1553413077-190dd305871c?w=800&q=80',
    ],
    features: ['Пандус', 'Ворота 4.5м', 'Охорона 24/7', 'Вага', '3-фазна електрика'],
    isNew: true,
  },
  {
    id: 4,
    title: 'Приміщення під кафе на Аркадії',
    type: 'Кафе/Ресторан',
    price: 20000,
    area: 105,
    floor: 1,
    totalFloors: 4,
    district: 'Приморський',
    address: 'вул. Генуезька, 24, Одеса',
    condition: 'Євроремонт',
    parking: false,
    separateEntrance: true,
    description: 'Готове приміщення під ресторан або кафе біля пляжу Аркадія. Витяжка, вентиляція встановлені. Є літня тераса з видом на море.',
    images: [
      'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&q=80',
      'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80',
    ],
    features: ['Витяжка', 'Тераса', 'Окремий вхід', 'Перша лінія', 'Вентиляція'],
    isPopular: true,
    isNew: true,
  },
  {
    id: 5,
    title: 'Салон краси / студія на Фонтані',
    type: 'Салон',
    price: 12000,
    area: 60,
    floor: 1,
    totalFloors: 5,
    district: 'Приморський',
    address: 'вул. Фонтанська дорога, 51, Одеса',
    condition: 'Євроремонт',
    parking: false,
    separateEntrance: true,
    description: 'Затишне приміщення для салону краси або студії у жвавому районі Великого Фонтану. Сантехніка підведена, є зона ресепшн.',
    images: [
      'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800&q=80',
      'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=800&q=80',
    ],
    features: ['Сантехніка', 'Ресепшн', 'Окремий вхід', 'Кондиціонер'],
    isNew: true,
  },
  {
    id: 6,
    title: 'Шоурум / лофт на Молдаванці',
    type: 'Шоурум',
    price: 16500,
    area: 90,
    floor: 2,
    totalFloors: 4,
    district: 'Приморський',
    address: 'вул. Мала Арнаутська, 46, Одеса',
    condition: 'Євроремонт',
    parking: true,
    separateEntrance: false,
    description: 'Стильний лофт-простір в історичному центрі Одеси. Високі стелі, великі вітрини. Підходить для шоуруму, дизайн-студії, фотостудії.',
    images: [
      'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=800&q=80',
      'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800&q=80',
    ],
    features: ['Лофт-стиль', 'Вітрини', 'Паркінг', 'Переговорні кімнати'],
    isFeatured: true,
  },
  {
    id: 7,
    title: 'Co-working на Французькому бульварі',
    type: 'Гнучкий простір',
    price: 8500,
    area: 40,
    floor: 3,
    totalFloors: 7,
    district: 'Приморський',
    address: 'Французький бульвар, 22, Одеса',
    condition: 'Євроремонт',
    parking: false,
    separateEntrance: false,
    description: 'Готовий гнучкий простір з меблями, інтернетом та всією інфраструктурою. Від 1 місяця. Ідеально для стартапів та фрілансерів.',
    images: [
      'https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=800&q=80',
      'https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?w=800&q=80',
    ],
    features: ['Меблі включено', 'Інтернет 1Gbps', 'Переговорна', 'Кава/чай', 'Від 1 міс'],
    isNew: true,
  },
  {
    id: 8,
    title: 'Офіс в БЦ "Мерідіан"',
    type: 'Офіс',
    price: 38000,
    area: 200,
    floor: 8,
    totalFloors: 16,
    district: 'Київський',
    address: 'просп. Небесної Сотні, 5, Одеса',
    condition: 'Євроремонт',
    parking: true,
    separateEntrance: false,
    description: 'Престижний офіс класу А у сучасному бізнес-центрі. Панорамний вид на місто, повна інфраструктура. Ідеально для великих компаній.',
    images: [
      'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=800&q=80',
      'https://images.unsplash.com/photo-1462826303086-329426d1aef5?w=800&q=80',
    ],
    features: ['Клас А', 'Панорама', 'Підземний паркінг', 'Ресепшн', 'Security'],
    isPopular: true,
    isFeatured: true,
  },
];

export const categories = [
  { id: 'all', label: 'Всі', icon: '🏢' },
  { id: 'Офіс', label: 'Офіси', icon: '💼' },
  { id: 'Рітейл', label: 'Рітейл', icon: '🛍️' },
  { id: 'Склад', label: 'Склади', icon: '📦' },
  { id: 'Кафе/Ресторан', label: 'Кафе', icon: '☕' },
  { id: 'Салон', label: 'Салони', icon: '✂️' },
  { id: 'Гнучкий простір', label: 'Гнучкі', icon: '⚡' },
  { id: 'Шоурум', label: 'Шоуруми', icon: '🎨' },
];

export const districts = [
  'Всі райони', 'Приморський', 'Київський', 'Суворовський', 'Малиновський',
  'Центр', 'Аркадія', 'Фонтан', 'Таїрова', 'Молдаванка'
];
