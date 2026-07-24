# 아바타 이미지 생성 프롬프트 키트

참고 예시(반실사 애니 미소녀 초상) **수준**으로, 하지만 **예시와 다른 오리지널 캐릭터**를
뽑기 위한 프롬프트 모음입니다. 미드저니 / DALL·E / Stable Diffusion / NanoBanana 등
아무 이미지 생성 AI에 넣으면 됩니다.

## 사용법
1. 아래 **공통 스타일**을 각 프롬프트 앞에 붙여서 생성합니다.
2. 생성된 이미지를 정사각형으로 크롭해 `public/avatars/<id>.png` 로 저장합니다.
3. 서버 재시작 → 게시판 전체에 반영됩니다. (`public/avatars/README.md`의 id 표 참고)

## 공통 스타일 (모든 프롬프트 앞에 붙이기)
```
semi-realistic anime portrait, beautiful young woman, head and shoulders,
centered composition, soft studio lighting, subtle glow, clean soft-gradient
background, highly detailed hair and eyes, smooth shading, digital painting,
profile avatar, square 1:1
```
### 네거티브(SD 계열)
```
lowres, blurry, extra fingers, text, watermark, logo, deformed, duplicate,
nsfw, harsh shadows
```
> 예시 이미지를 그대로 베끼지 않도록, 얼굴·의상 디테일을 아래 지정값으로 바꿔 생성하세요.

---

## 1. 무료 기본 아바타 (12종) — 심플·청량한 인상
| 파일명 | 프롬프트(공통 스타일 + 아래) |
|---|---|
| `basic-01.png` | soft pink long wavy hair, gentle smile, pastel pink theme, small hair clip |
| `basic-02.png` | sleek black long straight hair, cool calm expression, navy theme |
| `basic-03.png` | natural light-brown wavy hair, fresh innocent look, cream theme |
| `basic-04.png` | black bob hair with cat-ear headband, playful look, lavender theme |
| `basic-05.png` | dark ponytail with black cap and hoodie, streetwear vibe, mint theme |
| `basic-06.png` | glamorous golden wavy hair, elegant look, warm gold theme, earrings |
| `basic-07.png` | short cocoa-brown bob, calm friendly look, beige theme |
| `basic-08.png` | dreamy lilac purple wavy hair, soft gaze, light-purple theme |
| `basic-09.png` | mint-green updo bun, refreshing look, mint theme |
| `basic-10.png` | deep red wavy hair, confident look, ruby-red theme |
| `basic-11.png` | sky-blue high ponytail, cheerful look, light-blue theme |
| `basic-12.png` | mysterious figure in black hood, face partly shadowed, masquerade mask, dark theme |

## 2. 스페셜 헤어 (5,000P) — 헤어를 더 화려하게
| 파일명 | 프롬프트(공통 스타일 + 아래) |
|---|---|
| `hair-01.png` | elaborate hip-hop style, wavy hair with headphones, streetwear, cool expression |
| `hair-02.png` | luxurious wavy hair with ribbon and hair jewelry, soft romantic look |
| `hair-03.png` | intricate braided crown updo, delicate hair ornaments, refined elegant look |

## 3. 프리미엄 의상 (10,000P) — 의상·분위기 고급스럽게
| 파일명 | 프롬프트(공통 스타일 + 아래) |
|---|---|
| `outfit-01.png` | black formal tuxedo dress, elegant jewelry, luxurious sophisticated mood, dark background |
| `outfit-02.png` | crisp white office blouse, sleek bun, chic modern professional mood |
| `outfit-03.png` | glamorous red evening dress, necklace, bokeh light background, luxurious mood |

## 4. 이벤트 한정 (시즌) — 시즌 콘셉트
| 파일명 | 프롬프트(공통 스타일 + 아래) |
|---|---|
| `event-spring.png` | spring floral crown, cherry-blossom petals, fresh pastel-green theme |
| `event-xmas.png` | santa hat and cozy red-white outfit, festive lights, warm christmas mood |
| `event-halloween.png` | witch hat, purple magic glow, bats, spooky-cute halloween mood |

---

## 움직이는 테두리 (20,000P)
테두리는 **이미지가 아니라 CSS 애니메이션**으로 이미 구현돼 있어요
(네온 블루 / 선셋 골드 / 핑크 하트). 아바타 이미지 위에 자동으로 얹힙니다.

## 팁
- **일관성**이 중요해요. 같은 시드/스타일로 12종을 뽑으면 세트 느낌이 살아요.
- 원형으로 잘리니 **인물을 살짝 위쪽·가운데**에 두세요.
- 참고 예시의 인물을 그대로 재현하지 말고(저작권), 위 지정값으로 **다른 캐릭터**를 만드세요.
