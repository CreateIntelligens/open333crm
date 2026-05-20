/**
 * LINE Flex Message 精選範本 — 9 個官方 sample
 *
 * 來源：LINE Flex Message Simulator (https://developers.line.biz/flex-simulator/)
 * 對應 line_flex_showcase contentType
 *
 * 每個範本是完整可發送的 Flex Message JSON（type=bubble 或 type=carousel）。
 * 編輯器會自動掃出 body 內所有 text / image url / button action 給使用者修改，
 * 並支援用 JSON Pointer 路徑做新增 / 刪除欄位。
 */

export interface ShowcaseSample {
  id: string;
  name: string;
  description: string;
  /** 縮圖（仿 LINE Simulator 樣子，純 CSS） */
  thumbColor: string;
  /** 完整 Flex JSON */
  json: Record<string, unknown>;
}

export const SHOWCASE_SAMPLES: ShowcaseSample[] = [
  {
    id: 'restaurant',
    name: '餐廳介紹',
    description: '含星等、地址、營業時間與 CALL / WEBSITE 按鈕',
    thumbColor: '#8B4513',
    json: {
      type: 'bubble',
      hero: {
        type: 'image',
        url: 'https://developers-resource.landpress.line.me/fx/img/01_1_cafe.png',
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
        action: { type: 'uri', uri: 'https://line.me/' },
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'Brown Cafe', weight: 'bold', size: 'xl' },
          {
            type: 'box',
            layout: 'baseline',
            margin: 'md',
            contents: [
              { type: 'icon', size: 'sm', url: 'https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png' },
              { type: 'icon', size: 'sm', url: 'https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png' },
              { type: 'icon', size: 'sm', url: 'https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png' },
              { type: 'icon', size: 'sm', url: 'https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png' },
              { type: 'icon', size: 'sm', url: 'https://developers-resource.landpress.line.me/fx/img/review_gray_star_28.png' },
              { type: 'text', text: '4.0', size: 'sm', color: '#999999', margin: 'md', flex: 0 },
            ],
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'baseline',
                spacing: 'sm',
                contents: [
                  { type: 'text', text: 'Place', color: '#aaaaaa', size: 'sm', flex: 1 },
                  { type: 'text', text: 'Flex Tower, 7-7-4 Midori-ku, Tokyo', wrap: true, color: '#666666', size: 'sm', flex: 5 },
                ],
              },
              {
                type: 'box',
                layout: 'baseline',
                spacing: 'sm',
                contents: [
                  { type: 'text', text: 'Time', color: '#aaaaaa', size: 'sm', flex: 1 },
                  { type: 'text', text: '10:00 - 23:00', wrap: true, color: '#666666', size: 'sm', flex: 5 },
                ],
              },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: 'CALL', uri: 'https://line.me/' } },
          { type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: 'WEBSITE', uri: 'https://line.me/' } },
          { type: 'box', layout: 'vertical', contents: [], margin: 'sm' },
        ],
        flex: 0,
      },
    },
  },
  {
    id: 'apparel',
    name: '服飾商品',
    description: 'SALE 標籤覆蓋大圖、含原價刪除線與加入購物車按鈕',
    thumbColor: '#D32F2F',
    json: {
      type: 'carousel',
      contents: [
        {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'image', url: 'https://developers-resource.landpress.line.me/fx/clip/clip1.jpg', size: 'full', aspectMode: 'cover', aspectRatio: '2:3', gravity: 'top' },
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: "Brown's T-shirts", size: 'xl', color: '#ffffff', weight: 'bold' }] },
                  {
                    type: 'box',
                    layout: 'baseline',
                    contents: [
                      { type: 'text', text: '¥35,800', color: '#ebebeb', size: 'sm', flex: 0 },
                      { type: 'text', text: '¥75,000', color: '#ffffffcc', decoration: 'line-through', gravity: 'bottom', flex: 0, size: 'sm' },
                    ],
                    spacing: 'lg',
                  },
                  {
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                      { type: 'filler' },
                      {
                        type: 'box',
                        layout: 'baseline',
                        contents: [
                          { type: 'filler' },
                          { type: 'icon', url: 'https://developers-resource.landpress.line.me/fx/clip/clip14.png' },
                          { type: 'text', text: 'Add to cart', color: '#ffffff', flex: 0, offsetTop: '-2px' },
                          { type: 'filler' },
                        ],
                        spacing: 'sm',
                      },
                      { type: 'filler' },
                    ],
                    borderWidth: '1px',
                    cornerRadius: '4px',
                    spacing: 'sm',
                    borderColor: '#ffffff',
                    margin: 'xxl',
                    height: '40px',
                  },
                ],
                position: 'absolute',
                offsetBottom: '0px',
                offsetStart: '0px',
                offsetEnd: '0px',
                backgroundColor: '#03303Acc',
                paddingAll: '20px',
                paddingTop: '18px',
              },
              {
                type: 'box',
                layout: 'vertical',
                contents: [{ type: 'text', text: 'SALE', color: '#ffffff', align: 'center', size: 'xs', offsetTop: '3px' }],
                position: 'absolute',
                cornerRadius: '20px',
                offsetTop: '18px',
                backgroundColor: '#ff334b',
                offsetStart: '18px',
                height: '25px',
                width: '53px',
              },
            ],
            paddingAll: '0px',
          },
        },
        {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'image', url: 'https://developers-resource.landpress.line.me/fx/clip/clip2.jpg', size: 'full', aspectMode: 'cover', aspectRatio: '2:3', gravity: 'top' },
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: "Cony's T-shirts", size: 'xl', color: '#ffffff', weight: 'bold' }] },
                  {
                    type: 'box',
                    layout: 'baseline',
                    contents: [
                      { type: 'text', text: '¥35,800', color: '#ebebeb', size: 'sm', flex: 0 },
                      { type: 'text', text: '¥75,000', color: '#ffffffcc', decoration: 'line-through', gravity: 'bottom', flex: 0, size: 'sm' },
                    ],
                    spacing: 'lg',
                  },
                  {
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                      { type: 'filler' },
                      {
                        type: 'box',
                        layout: 'baseline',
                        contents: [
                          { type: 'filler' },
                          { type: 'icon', url: 'https://developers-resource.landpress.line.me/fx/clip/clip14.png' },
                          { type: 'text', text: 'Add to cart', color: '#ffffff', flex: 0, offsetTop: '-2px' },
                          { type: 'filler' },
                        ],
                        spacing: 'sm',
                      },
                      { type: 'filler' },
                    ],
                    borderWidth: '1px',
                    cornerRadius: '4px',
                    spacing: 'sm',
                    borderColor: '#ffffff',
                    margin: 'xxl',
                    height: '40px',
                  },
                ],
                position: 'absolute',
                offsetBottom: '0px',
                offsetStart: '0px',
                offsetEnd: '0px',
                backgroundColor: '#9C8E7Ecc',
                paddingAll: '20px',
                paddingTop: '18px',
              },
              {
                type: 'box',
                layout: 'vertical',
                contents: [{ type: 'text', text: 'SALE', color: '#ffffff', align: 'center', size: 'xs', offsetTop: '3px' }],
                position: 'absolute',
                cornerRadius: '20px',
                offsetTop: '18px',
                backgroundColor: '#ff334b',
                offsetStart: '18px',
                height: '25px',
                width: '53px',
              },
            ],
            paddingAll: '0px',
          },
        },
      ],
    },
  },
  {
    id: 'local_search',
    name: '地點搜尋',
    description: '3 張小卡輪播，適合景點 / 店家推薦',
    thumbColor: '#5D4037',
    json: {
      type: 'carousel',
      contents: [
        microRestaurantBubble('Brown Cafe', 'https://developers-resource.landpress.line.me/fx/clip/clip10.jpg'),
        microRestaurantBubble("Brown&Cony's Restaurant", 'https://developers-resource.landpress.line.me/fx/clip/clip11.jpg'),
        microRestaurantBubble('Tata', 'https://developers-resource.landpress.line.me/fx/clip/clip12.jpg'),
      ],
    },
  },
  {
    id: 'real_estate',
    name: '房地產',
    description: 'NEW 標籤 + 拼圖式 hero 圖 + 深藍底色',
    thumbColor: '#464F69',
    json: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'image', url: 'https://developers-resource.landpress.line.me/fx/clip/clip4.jpg', size: 'full', aspectMode: 'cover', aspectRatio: '150:196', gravity: 'center', flex: 1 },
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  { type: 'image', url: 'https://developers-resource.landpress.line.me/fx/clip/clip5.jpg', size: 'full', aspectMode: 'cover', aspectRatio: '150:98', gravity: 'center' },
                  { type: 'image', url: 'https://developers-resource.landpress.line.me/fx/clip/clip6.jpg', size: 'full', aspectMode: 'cover', aspectRatio: '150:98', gravity: 'center' },
                ],
                flex: 1,
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [{ type: 'text', text: 'NEW', size: 'xs', color: '#ffffff', align: 'center', gravity: 'center' }],
                backgroundColor: '#EC3D44',
                paddingAll: '2px',
                paddingStart: '4px',
                paddingEnd: '4px',
                flex: 0,
                position: 'absolute',
                offsetStart: '18px',
                offsetTop: '18px',
                cornerRadius: '100px',
                width: '48px',
                height: '25px',
              },
            ],
          },
        ],
        paddingAll: '0px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  { type: 'text', contents: [], size: 'xl', wrap: true, text: 'Cony Residence', color: '#ffffff', weight: 'bold' },
                  { type: 'text', text: '3 Bedrooms, ¥35,000', color: '#ffffffcc', size: 'sm' },
                ],
                spacing: 'sm',
              },
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'box',
                    layout: 'vertical',
                    contents: [{ type: 'text', contents: [], size: 'sm', wrap: true, margin: 'lg', color: '#ffffffde', text: 'Private Pool, Delivery box, Floor heating, Private Cinema' }],
                  },
                ],
                paddingAll: '13px',
                backgroundColor: '#ffffff1A',
                cornerRadius: '2px',
                margin: 'xl',
              },
            ],
          },
        ],
        paddingAll: '20px',
        backgroundColor: '#464F69',
      },
    },
  },
  {
    id: 'social',
    name: '社群動態',
    description: '拼圖式圖片 + 圓形頭像 + 貼文文字',
    thumbColor: '#90A4AE',
    json: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'image', url: 'https://developers-resource.landpress.line.me/fx/clip/clip7.jpg', size: '5xl', aspectMode: 'cover', aspectRatio: '150:196', gravity: 'center', flex: 1 },
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  { type: 'image', url: 'https://developers-resource.landpress.line.me/fx/clip/clip8.jpg', size: 'full', aspectMode: 'cover', aspectRatio: '150:98', gravity: 'center' },
                  { type: 'image', url: 'https://developers-resource.landpress.line.me/fx/clip/clip9.jpg', size: 'full', aspectMode: 'cover', aspectRatio: '150:98', gravity: 'center' },
                ],
                flex: 1,
              },
            ],
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                contents: [{ type: 'image', url: 'https://developers-resource.landpress.line.me/fx/clip/clip13.jpg', aspectMode: 'cover', size: 'full' }],
                cornerRadius: '100px',
                width: '72px',
                height: '72px',
              },
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'text',
                    contents: [
                      { type: 'span', text: 'brown_05', weight: 'bold', color: '#000000' },
                      { type: 'span', text: '     ' },
                      { type: 'span', text: 'I went to the Brown&Cony cafe in Tokyo and took a picture' },
                    ],
                    size: 'sm',
                    wrap: true,
                  },
                  {
                    type: 'box',
                    layout: 'baseline',
                    contents: [{ type: 'text', text: '1,140,753 Like', size: 'sm', color: '#bcbcbc' }],
                    spacing: 'sm',
                    margin: 'md',
                  },
                ],
              },
            ],
            spacing: 'xl',
            paddingAll: '20px',
          },
        ],
        paddingAll: '0px',
      },
    },
  },
  {
    id: 'todo',
    name: '任務進度',
    description: '3 張色塊小卡，每張帶進度百分比',
    thumbColor: '#27ACB2',
    json: {
      type: 'carousel',
      contents: [
        todoBubble('In Progress', '70%', 70, '#27ACB2', '#0D8186', '#9FD8E36E', 'Buy milk and lettuce before class'),
        todoBubble('Pending', '30%', 30, '#FF6B6E', '#DE5658', '#FAD2A76E', 'Wash my car'),
        todoBubble('In Progress', '100%', 100, '#A17DF5', '#7D51E4', '#9FD8E36E', 'Buy milk and lettuce before class'),
      ],
    },
  },
  {
    id: 'shopping',
    name: '電商商品',
    description: '商品輪播，含售完狀態與「查看更多」卡',
    thumbColor: '#FF5722',
    json: {
      type: 'carousel',
      contents: [
        shoppingBubble('Arm Chair, White', '49', 'https://developers-resource.landpress.line.me/fx/img/01_5_carousel.png', false),
        shoppingBubble('Metal Desk Lamp', '11', 'https://developers-resource.landpress.line.me/fx/img/01_6_carousel.png', true),
        {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
              { type: 'button', flex: 1, gravity: 'center', action: { type: 'uri', label: 'See more', uri: 'https://line.me/' } },
            ],
          },
        },
      ],
    },
  },
  {
    id: 'menu',
    name: '餐點菜單',
    description: '餐點圖文菜單，含 icon、價格與熱量',
    thumbColor: '#905C44',
    json: {
      type: 'bubble',
      hero: {
        type: 'image',
        url: 'https://developers-resource.landpress.line.me/fx/img/01_2_restaurant.png',
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
        action: { type: 'uri', uri: 'https://line.me/' },
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        action: { type: 'uri', uri: 'https://line.me/' },
        contents: [
          { type: 'text', text: "Brown's Burger", size: 'xl', weight: 'bold' },
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'icon', url: 'https://developers-resource.landpress.line.me/fx/img/restaurant_regular_32.png' },
                  { type: 'text', text: '$10.5', weight: 'bold', margin: 'sm', flex: 0 },
                  { type: 'text', text: '400kcl', size: 'sm', align: 'end', color: '#aaaaaa' },
                ],
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'icon', url: 'https://developers-resource.landpress.line.me/fx/img/restaurant_large_32.png' },
                  { type: 'text', text: '$15.5', weight: 'bold', margin: 'sm', flex: 0 },
                  { type: 'text', text: '550kcl', size: 'sm', align: 'end', color: '#aaaaaa' },
                ],
              },
            ],
          },
          { type: 'text', text: 'Sauce, Onions, Pickles, Lettuce & Cheese', wrap: true, color: '#aaaaaa', size: 'xxs' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#905c44',
            margin: 'xxl',
            action: { type: 'uri', label: 'Add to Cart', uri: 'https://line.me/' },
          },
        ],
      },
    },
  },
  {
    id: 'ticket',
    name: '電影票券',
    description: '含星等、Date / Place / Seats 與 QR code',
    thumbColor: '#000000',
    json: {
      type: 'bubble',
      hero: {
        type: 'image',
        url: 'https://developers-resource.landpress.line.me/fx/img/01_3_movie.png',
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
        action: { type: 'uri', uri: 'https://line.me/' },
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: "BROWN'S ADVENTURE\nIN MOVIE", wrap: true, weight: 'bold', gravity: 'center', size: 'xl' },
          {
            type: 'box',
            layout: 'baseline',
            margin: 'md',
            contents: [
              { type: 'icon', size: 'sm', url: 'https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png' },
              { type: 'icon', size: 'sm', url: 'https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png' },
              { type: 'icon', size: 'sm', url: 'https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png' },
              { type: 'icon', size: 'sm', url: 'https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png' },
              { type: 'icon', size: 'sm', url: 'https://developers-resource.landpress.line.me/fx/img/review_gray_star_28.png' },
              { type: 'text', text: '4.0', size: 'sm', color: '#999999', margin: 'md', flex: 0 },
            ],
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'sm',
            contents: [
              ticketRow('Date', 'Monday 25, 9:00PM'),
              ticketRow('Place', '7 Floor, No.3'),
              ticketRow('Seats', 'C Row, 18 Seat'),
            ],
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'xxl',
            contents: [
              { type: 'image', url: 'https://developers-resource.landpress.line.me/fx/img/linecorp_code_withborder.png', aspectMode: 'cover', size: 'xl', margin: 'md' },
              { type: 'text', text: 'You can enter the theater by using this code instead of a ticket', color: '#aaaaaa', wrap: true, margin: 'xxl', size: 'xs' },
            ],
          },
        ],
      },
    },
  },
];

// ─── helpers ────────────────────────────────────────────────────

function microRestaurantBubble(title: string, imageUrl: string) {
  return {
    type: 'bubble',
    size: 'micro',
    hero: { type: 'image', url: imageUrl, size: 'full', aspectMode: 'cover', aspectRatio: '320:213' },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: title, weight: 'bold', size: 'sm', wrap: true },
        {
          type: 'box',
          layout: 'baseline',
          contents: [
            { type: 'icon', size: 'xs', url: 'https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png' },
            { type: 'icon', size: 'xs', url: 'https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png' },
            { type: 'icon', size: 'xs', url: 'https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png' },
            { type: 'icon', size: 'xs', url: 'https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png' },
            { type: 'icon', size: 'xs', url: 'https://developers-resource.landpress.line.me/fx/img/review_gray_star_28.png' },
            { type: 'text', text: '4.0', size: 'xs', color: '#8c8c8c', margin: 'md', flex: 0 },
          ],
        },
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'box',
              layout: 'baseline',
              spacing: 'sm',
              contents: [{ type: 'text', text: '東京旅行', wrap: true, color: '#8c8c8c', size: 'xs', flex: 5 }],
            },
          ],
        },
      ],
      spacing: 'sm',
      paddingAll: '13px',
    },
  };
}

function todoBubble(label: string, percent: string, percentNum: number, bgColor: string, fillColor: string, trackColor: string, description: string) {
  return {
    type: 'bubble',
    size: 'nano',
    header: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: label, color: '#ffffff', align: 'start', size: 'md', gravity: 'center' },
        { type: 'text', text: percent, color: '#ffffff', align: 'start', size: 'xs', gravity: 'center', margin: 'lg' },
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              contents: [{ type: 'filler' }],
              width: `${percentNum}%`,
              backgroundColor: fillColor,
              height: '6px',
            },
          ],
          backgroundColor: trackColor,
          height: '6px',
          margin: 'sm',
        },
      ],
      backgroundColor: bgColor,
      paddingTop: '19px',
      paddingAll: '12px',
      paddingBottom: '16px',
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          contents: [{ type: 'text', text: description, color: '#8C8C8C', size: 'sm', wrap: true }],
          flex: 1,
        },
      ],
      spacing: 'md',
      paddingAll: '12px',
    },
    styles: { footer: { separator: false } },
  };
}

function shoppingBubble(title: string, price: string, heroUrl: string, soldOut: boolean) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bodyContents: any[] = [
    { type: 'text', text: title, wrap: true, weight: 'bold', size: 'xl' },
    {
      type: 'box',
      layout: 'baseline',
      ...(soldOut ? { flex: 1 } : {}),
      contents: [
        { type: 'text', text: `$${price}`, wrap: true, weight: 'bold', size: 'xl', flex: 0 },
        { type: 'text', text: '.99', wrap: true, weight: 'bold', size: 'sm', flex: 0 },
      ],
    },
  ];
  if (soldOut) {
    bodyContents.push({ type: 'text', text: 'Temporarily out of stock', wrap: true, size: 'xxs', margin: 'md', color: '#ff5551', flex: 0 });
  }
  return {
    type: 'bubble',
    hero: { type: 'image', size: 'full', aspectRatio: '20:13', aspectMode: 'cover', url: heroUrl },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: bodyContents },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        {
          type: 'button',
          ...(soldOut ? { flex: 2, color: '#aaaaaa' } : {}),
          style: 'primary',
          action: { type: 'uri', label: 'Add to Cart', uri: 'https://line.me/' },
        },
        { type: 'button', action: { type: 'uri', label: 'Add to wishlist', uri: 'https://line.me/' } },
      ],
    },
  };
}

function ticketRow(label: string, value: string) {
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, color: '#aaaaaa', size: 'sm', flex: 1 },
      { type: 'text', text: value, wrap: true, color: '#666666', size: 'sm', flex: 4 },
    ],
  };
}
