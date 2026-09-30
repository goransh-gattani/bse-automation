from bse_announcements.api import parse_response, pdf_url


def test_pdf_url():
    assert (
        pdf_url("ec7be7e3-5e18-47a4-b75a-36f0ef9106cf.pdf")
        == "https://www.bseindia.com/xml-data/corpfiling/AttachHis/ec7be7e3-5e18-47a4-b75a-36f0ef9106cf.pdf"
    )
    assert pdf_url("") == ""
    assert pdf_url(None) == ""


def test_parse_response():
    data = {
        "Table": [
            {
                "NEWS_DT": "2026-08-12T18:05:00",
                "SLONGNAME": "Acme Ltd",
                "HEADLINE": "Financial Results for Q1",
                "NEWSSUB": "Results",
                "SUBCATNAME": "Financial Results",
                "ATTACHMENTNAME": "abc.pdf",
            },
            {"HEADLINE": "No attachment", "ATTACHMENTNAME": None},
        ],
        "Table1": [{"ROWCNT": 2}],
    }
    anns, total = parse_response(data)
    assert total == 2
    assert anns[0].pdf_url.endswith("/AttachHis/abc.pdf")
    assert anns[1].pdf_url == ""
