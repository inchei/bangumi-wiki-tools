import { extractStaffInfo } from './extract.js';
import { updAppearEps } from './person-matching.js';
import { getInfoboxStaffInfo } from './infobox.js';
import { getEps, parseEpLabel, setEpsCache } from './ep.js';

(async function main() {
  if (location.pathname.match(/^\/ep\/\d+$/)) {
    const subjectId = document.querySelector('.nameSingle a').href.split('/').pop();
    const epLabel = parseEpLabel(document.title);
    const epDesc = document.querySelector('.epDesc')?.textContent;
    if (!epDesc) return;

    const [sfaffInfo] = extractStaffInfo({ [epLabel]: epDesc });
    const staffJSON = JSON.stringify(sfaffInfo);
    if (staffJSON === '{}') return;

    document
      .querySelector('.title')
      .insertAdjacentHTML(
        'beforeend',
        `<small><a class="l staff-link" href="/subject/${subjectId}/add_related/person?source=${epLabel}&staffs=${encodeURIComponent(staffJSON)}">[关联制作人员参与]</a></small>`,
      );
  }
  if (location.pathname.match(/^\/person\/new$/)) {
    const params = new URLSearchParams(location.search);
    if (!params.has('name')) return;
    const name = params.get('name');
    document.querySelector('#crt_name').value = name;
  } else if (location.pathname.match(/^\/subject\/\d+\/add_related\/person$/)) {
    const isAnime = document.querySelector('.focus').classList.contains('anime');
    const subjectId = location.pathname.split('/')[2];
    const catBox = document.querySelector('#indexCatBox');

    let btn = null;
    if (isAnime) {
      btn = document.createElement('button');
      btn.textContent = '获取章节简介填写参与';
      btn.id = 'epDescStaff';
      btn.style = 'margin:5px;float:right';
      btn.addEventListener('click', async () => {
        try {
          btn.disabled = true;
          btn.textContent = '获取章节中……';

          const allEps = [];
          let offset = 0;
          const limit = 100;

          while (true) {
            const eps = await getEps(subjectId, offset);
            if (!eps || eps.length === 0) break;

            allEps.push(...eps);
            if (eps.length < limit) break;

            offset += limit;
          }

          if (!allEps.length) throw new Error('未获取到章节数据');

          const epData = {},
            epDescs = {};
          for (const ep of allEps) {
            const epTypes = ['', 'SP', 'OP', 'ED'];
            const epLabel = `${epTypes[ep.type]}${ep.sort}`;

            epData[epLabel] = ep;
            epDescs[epLabel] = ep.desc;
          }
          setEpsCache(epData);

          btn.textContent = '解析参与中……';
          const [staffInfo, noStaffEps] = extractStaffInfo(epDescs);

          if (Object.keys(staffInfo).length || noStaffEps.length) {
            await updAppearEps(staffInfo, noStaffEps);
          } else {
            throw new Error('未解析到任何集数的人员信息');
          }

          btn.textContent = `解析完成！共处理 ${allEps.length} 集`;
        } catch (e) {
          alert(`获取失败：${e.message}`);
          btn.textContent = '获取失败，点击重试';
          btn.disabled = false;
        }
      });
      catBox.after(btn);
    }

    // 根据 infobox 关联：动画页挂在获取章节按钮上方，其他类型直接放类型栏后
    const infoboxBtn = document.createElement('button');
    infoboxBtn.textContent = '根据infobox关联';
    infoboxBtn.id = 'infoboxStaff';
    infoboxBtn.style = 'margin:5px;float:right';
    infoboxBtn.addEventListener('click', async () => {
      try {
        infoboxBtn.disabled = true;
        infoboxBtn.textContent = '解析infobox中……';

        const { staffInfo, unknownRoles } = await getInfoboxStaffInfo();
        if (!Object.keys(staffInfo).length) throw new Error('未从infobox解析到任何人员信息');

        await updAppearEps(staffInfo, [], {
          summary: '根据infobox关联人物',
          progress: '解析中',
          indicatorId: 'infoboxStaff',
        });
        infoboxBtn.textContent =
          `解析完成！共 ${Object.keys(staffInfo).length} 人` +
          (unknownRoles.length ? `，未识别职位：${unknownRoles.join('、')}` : '');
      } catch (e) {
        alert(`获取失败：${e.message}`);
        infoboxBtn.textContent = '获取失败，点击重试';
        infoboxBtn.disabled = false;
      }
    });
    if (btn) {
      btn.insertAdjacentElement('beforebegin', infoboxBtn);
    } else {
      catBox.after(infoboxBtn);
    }

    const params = new URLSearchParams(location.search);
    if (params.has('staffs') && btn) {
      try {
        const staffInfo = JSON.parse(params.get('staffs'));

        let cancelled = false;
        document.addEventListener(
          'click',
          () => {
            cancelled = true;
          },
          { capture: true, once: true },
        );
        const waitRelate = () => {
          if (cancelled) return Promise.resolve(false);
          if (document.querySelector('#crtRelateSubjects')) return Promise.resolve(true);
          return new Promise((resolve) => setTimeout(() => resolve(waitRelate()), 200));
        };
        if (!(await waitRelate())) return;

        btn.disabled = true;
        btn.textContent = '解析参与中……';
        await updAppearEps(staffInfo, []);
        btn.textContent = '解析完成！点击获取全部章节';
        btn.disabled = false;
      } catch (e) {
        console.error(`参数解析错误：${e.message}`);
      }
    }
  }
})();
