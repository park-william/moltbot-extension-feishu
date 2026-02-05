export const textEvent = {
    message: {
        message_id: "om_text_test",
        chat_id: "oc_test_chat",
        message_type: "text",
        content: JSON.stringify({ text: "Hello Regression" })
    },
    sender: {
        sender_id: { open_id: "ou_tester" }
    }
};

export const imageEvent = {
    message: {
        message_id: "om_image_test",
        chat_id: "oc_test_chat",
        message_type: "image",
        content: JSON.stringify({ image_key: "img_test_key" })
    },
    sender: {
        sender_id: { open_id: "ou_tester" }
    }
};

export const postEvent = {
    message: {
        message_id: "om_post_test",
        chat_id: "oc_test_chat",
        message_type: "post",
        content: {
            "zh_cn": {
                title: "Rich Text Test",
                content: [
                    [
                        { tag: "text", text: "Text part" },
                        { tag: "img", image_key: "img_in_post_key" }
                    ]
                ]
            }
        }
    },
    sender: {
        sender_id: { open_id: "ou_tester" }
    }
};

export const buttonClickEvent = {
    open_chat_id: "oc_test_chat",
    open_message_id: "om_card_test",
    action: {
        value: { action: "click_me" }
    },
    operator: {
        open_id: "ou_tester"
    }
};
