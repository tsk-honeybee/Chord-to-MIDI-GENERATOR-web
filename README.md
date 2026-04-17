# Chord to MIDI Generator PWA

브라우저에서 코드 차트를 편집하고, 보이싱 옵션을 적용해 MIDI로 바로 내보내는 PWA입니다.

## Features

- 설치 가능한 PWA
- 파트별 키와 마디 편집
- 알파벳 표기와 도수 표기 전환
- 코드 빌더와 선택 마디 미리보기
- 텍스트 차트 파서와 `.txt` 내보내기
- 브라우저 내 MIDI 생성

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run typecheck
npm run build
```

## GitHub Pages Deploy

1. 이 프로젝트를 GitHub 저장소에 푸시합니다.
2. GitHub 저장소의 `Settings > Pages` 로 이동합니다.
3. `Build and deployment` 의 `Source` 를 `GitHub Actions` 로 설정합니다.
4. `main` 브랜치에 푸시하면 `.github/workflows/deploy-pages.yml` 이 자동으로 빌드/배포합니다.

배포 주소는 보통 `https://<github-username>.github.io/<repository-name>/` 형식입니다.

이 저장소에서는 기존 데스크톱 앱용 `TUF`, 자동 업데이트, PyInstaller 스펙 파일을 제거하고 웹 PWA 기준으로 재구성했습니다.
