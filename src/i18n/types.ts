export interface Dictionary {
  metadata: {
    title: string;
    description: string;
  };
  nav: {
    home: string;
    about: string;
    programs: string;
    contact: string;
    signIn: string;
    intranet: string;
  };
  home: {
    hero: {
      title: string;
      subtitle: string;
      cta: string;
    };
    mission: {
      title: string;
      description: string;
    };
  };
  about: {
    title: string;
    description: string;
    history: {
      title: string;
      content: string;
    };
  };
  programs: {
    title: string;
    description: string;
    list: {
      title: string;
      description: string;
    }[];
  };
  contact: {
    title: string;
    description: string;
    form: {
      name: string;
      email: string;
      message: string;
      submit: string;
    };
  };
  footer: {
    rights: string;
    language: string;
  };
}
